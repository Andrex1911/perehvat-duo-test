"""Accounts, immutable reward ledger, and cooperative board interactions."""
import hashlib,hmac,json,secrets,time,sqlite3,re
from urllib.parse import urlsplit
from fastapi import HTTPException,Request,Response
from pydantic import BaseModel,Field
COOKIE='perehvat_account'
RANKS=[(0,'Стажёр'),(600,'Детектив'),(1400,'Эксперт'),(2400,'Мастер расследований')]
def init_social(c):
 for sql in [
 'CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,login TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,created REAL NOT NULL)',
 'CREATE TABLE IF NOT EXISTS player_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL)',
 'CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires REAL NOT NULL)',
 'CREATE TABLE IF NOT EXISTS room_members(code TEXT NOT NULL,role TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(code,role),UNIQUE(code,user_id))',
 'CREATE TABLE IF NOT EXISTS rewards(user_id TEXT NOT NULL,case_id TEXT NOT NULL,code TEXT NOT NULL,xp INTEGER NOT NULL,credits INTEGER NOT NULL,badges TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(user_id,case_id))',
 'CREATE TABLE IF NOT EXISTS board_votes(code TEXT NOT NULL,evidence TEXT NOT NULL,role TEXT NOT NULL,vote TEXT NOT NULL,PRIMARY KEY(code,evidence,role))',
 'CREATE TABLE IF NOT EXISTS board_positions(code TEXT NOT NULL,node TEXT NOT NULL,x REAL NOT NULL,y REAL NOT NULL,PRIMARY KEY(code,node))']:
  c.execute(sql)
def digest(token):return hashlib.sha256(token.encode()).hexdigest()
def pw(password,salt):return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()
def origin(req):
 o=req.headers.get('origin')
 if o and urlsplit(o).netloc!=req.headers.get('host'):raise HTTPException(403,'Запрос должен идти с сайта игры')
def account_id(c,req,required=False):
 token=req.cookies.get(COOKIE,'');row=c.execute('SELECT user_id FROM player_sessions WHERE token=? AND expires>?',(digest(token),time.time())).fetchone()
 if not row and required:raise HTTPException(401,'Войдите в профиль')
 return row['user_id'] if row else None
def bind_member(c,code,role,uid):
 if not uid:return
 other=c.execute('SELECT role FROM room_members WHERE code=? AND user_id=?',(code,uid)).fetchone()
 if other and other['role']!=role:raise HTTPException(409,'Один аккаунт не может играть за двоих в одной комнате')
 prior=c.execute('SELECT user_id FROM room_members WHERE code=? AND role=?',(code,role)).fetchone()
 if prior and prior['user_id']!=uid:raise HTTPException(403,'Это место уже связано с другим аккаунтом')
 c.execute('INSERT OR IGNORE INTO room_members VALUES(?,?,?)',(code,role,uid))
def award(c,row,stats):
 if not row['done']:return
 xp=stats['points'];badges=['Первое раскрытие']
 if xp>=900:badges.append('Точная дедукция')
 if not(stats['wrong'] or stats['hints'] or stats['verdict_retries']):badges.append('Безупречная команда')
 credits=100+xp//10+(25 if 'Безупречная команда' in badges else 0)
 for member in c.execute('SELECT user_id FROM room_members WHERE code=?',(row['code'],)).fetchall():
  c.execute('INSERT OR IGNORE INTO rewards VALUES(?,?,?,?,?,?,?)',(member['user_id'],row['case_id'],row['code'],xp,credits,json.dumps(badges,ensure_ascii=False),time.time()))
def board_snapshot(c,code):
 votes={}
 for v in c.execute('SELECT evidence,role,vote FROM board_votes WHERE code=?',(code,)):votes.setdefault(v['evidence'],{})[v['role']]=v['vote']
 return {'opinions':votes,'positions':{p['node']:{'x':p['x'],'y':p['y']} for p in c.execute('SELECT node,x,y FROM board_positions WHERE code=?',(code,))},'players':{m['role']:m['name'] for m in c.execute('SELECT m.role,p.name FROM room_members m JOIN players p ON p.id=m.user_id WHERE m.code=?',(code,))}}
class Credentials(BaseModel):
 login:str=Field(min_length=3,max_length=24,pattern=r'^[a-zA-Z0-9_]+$')
 password:str=Field(min_length=8,max_length=128)
 name:str=Field(default='',max_length=32)
class Rename(BaseModel):name:str=Field(min_length=1,max_length=32)
class PasswordChange(BaseModel):
 current:str=Field(min_length=8,max_length=128)
 new:str=Field(min_length=8,max_length=128)
class Opinion(BaseModel):
 evidence_id:str=Field(min_length=5,max_length=35)
 vote:str=Field(pattern='^(trust|doubt|neutral)$')
class Placement(BaseModel):
 node:str=Field(min_length=1,max_length=45)
 x:float=Field(ge=0,le=900,allow_inf_nan=False)
 y:float=Field(ge=0,le=7000,allow_inf_nan=False)
class TheoryEvidence(BaseModel):
    theory_id:str=Field(min_length=1,max_length=45)
    evidence_id:str=Field(min_length=5,max_length=35)
class RemoveLink(BaseModel):
    source:str=Field(min_length=5,max_length=35)
    target:str=Field(min_length=5,max_length=35)
    relation:str=Field(pattern="^(corroborates|contradicts|timeline)$")
class Review(BaseModel):
 theory_id:str=Field(min_length=1,max_length=45)
 decision:str=Field(pattern='^(agree|recheck|reject)$')

def register_routes(router,db,row_and_role,require_paid_stage,event,stamp,score):
 def throttle(c,req):
  key=digest((req.client.host if req.client else 'unknown')+'auth');now=time.time()
  c.execute('DELETE FROM auth_limits WHERE expires<?',(now,));row=c.execute('SELECT count FROM auth_limits WHERE key=?',(key,)).fetchone()
  if row and row['count']>=15:raise HTTPException(429,'Слишком много попыток. Подождите 15 минут.')
  c.execute('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',(key,now+900))
 def session(c,uid,response,req):
  token=secrets.token_urlsafe(32);c.execute('DELETE FROM player_sessions WHERE expires<?',(time.time(),));c.execute('INSERT INTO player_sessions VALUES(?,?,?)',(digest(token),uid,time.time()+30*86400))
  response.set_cookie(COOKIE,token,httponly=True,secure=req.url.scheme=='https',samesite='strict',max_age=30*86400,path='/')
 @router.post('/account/register')
 def register(body:Credentials,request:Request,response:Response):
  origin(request)
  with db() as c:
   throttle(c,request);salt=secrets.token_hex(16);uid=secrets.token_hex(16)
   try:c.execute('INSERT INTO players VALUES(?,?,?,?,?,?)',(uid,body.login.lower(),body.name.strip() or body.login,salt,pw(body.password,salt),time.time()))
   except sqlite3.IntegrityError:raise HTTPException(409,'Логин уже занят')
   session(c,uid,response,request)
  return {'ok':True}
 @router.post('/account/login')
 def login(body:Credentials,request:Request,response:Response):
  origin(request)
  with db() as c:
   throttle(c,request);p=c.execute('SELECT * FROM players WHERE login=?',(body.login.lower(),)).fetchone();actual=pw(body.password,p['salt'] if p else '00'*16)
   if not p or not hmac.compare_digest(actual,p['password']):raise HTTPException(401,'Неверный логин или пароль')
   session(c,p['id'],response,request)
  return {'ok':True}
 @router.post('/account/logout')
 def logout(request:Request,response:Response):
  origin(request)
  with db() as c:c.execute('DELETE FROM player_sessions WHERE token=?',(digest(request.cookies.get(COOKIE,'')),))
  response.delete_cookie(COOKIE,path='/');return {'ok':True}
 @router.post('/account/name')
 def rename(body:Rename,request:Request):
  origin(request)
  if not body.name.strip():raise HTTPException(422,'Введите имя')
  with db() as c:
   uid=account_id(c,request,True);c.execute('UPDATE players SET name=? WHERE id=?',(body.name.strip(),uid))
  return {'ok':True}
 @router.post('/account/password')
 def password(body:PasswordChange,request:Request,response:Response):
  origin(request)
  with db() as c:
   uid=account_id(c,request,True);throttle(c,request);p=c.execute('SELECT * FROM players WHERE id=?',(uid,)).fetchone()
   if not hmac.compare_digest(pw(body.current,p['salt']),p['password']):raise HTTPException(401,'Неверный текущий пароль')
   salt=secrets.token_hex(16);c.execute('BEGIN IMMEDIATE');c.execute('UPDATE players SET salt=?,password=? WHERE id=?',(salt,pw(body.new,salt),uid));c.execute('DELETE FROM player_sessions WHERE user_id=?',(uid,));session(c,uid,response,request);c.execute('COMMIT')
  return {'ok':True}
 @router.get('/account/me')
 def me(request:Request,response:Response):
  response.headers['Cache-Control']='no-store'
  with db() as c:
   uid=account_id(c,request)
   if not uid:return {'authenticated':False}
   p=c.execute('SELECT login,name,created FROM players WHERE id=?',(uid,)).fetchone();ledger=[dict(x) for x in c.execute('SELECT case_id,code,xp,credits,badges,created FROM rewards WHERE user_id=? ORDER BY created DESC',(uid,))];xp=sum(x['xp'] for x in ledger);index=max(i for i,(threshold,_) in enumerate(RANKS) if xp>=threshold)
   rooms=[dict(x) for x in c.execute('SELECT r.code,r.case_id,r.stage,r.done,m.role FROM room_members m JOIN duo_rooms r ON r.code=m.code WHERE m.user_id=? ORDER BY r.created_at DESC LIMIT 30',(uid,))]
  badges=sorted({b for x in ledger for b in json.loads(x['badges'])})
  if len(ledger)>=3:badges.append('Три дела — одна команда')
  return {'authenticated':True,**dict(p),'xp':xp,'balance':sum(x['credits'] for x in ledger),'rank':RANKS[index][1],'rank_index':index,'next_rank':RANKS[index+1][0] if index<3 else None,'badges':badges,'ledger':ledger,'rooms':rooms,'points_shop_enabled':False}
 @router.post('/rooms/{code}/account/attach')
 def attach(code:str,request:Request):
  origin(request);row,role=row_and_role(code,request)
  with db() as c:
   c.execute('BEGIN IMMEDIATE');uid=account_id(c,request,True);current=c.execute('SELECT done FROM duo_rooms WHERE code=?',(code,)).fetchone()
   if current['done']:raise HTTPException(409,'Завершённое дело нельзя привязать задним числом')
   bind_member(c,code,role,uid);c.execute('COMMIT')
  return {'ok':True}
 @router.post('/account/rooms/{code}/resume')
 def resume(code:str,request:Request):
  origin(request)
  with db() as c:
   uid=account_id(c,request,True);m=c.execute('SELECT m.role,r.case_id FROM room_members m JOIN duo_rooms r ON r.code=m.code WHERE m.code=? AND m.user_id=?',(code,uid)).fetchone()
   if not m:raise HTTPException(404,'Дело не найдено в профиле')
   token=secrets.token_urlsafe(32);column='host_hash' if m['role']=='a' else 'guest_hash';c.execute(f'UPDATE duo_rooms SET {column}=? WHERE code=?',(digest(token),code))
  return {'code':code,'token':token,'role':m['role'],'case_id':m['case_id']}
 @router.post('/rooms/{code}/opinion')
 def opinion(code:str,body:Opinion,request:Request):
  row,role=row_and_role(code,request);require_paid_stage(row)
  with db() as c:
   c.execute('BEGIN IMMEDIATE');current=c.execute('SELECT pinned,events FROM duo_rooms WHERE code=?',(code,)).fetchone();pins=json.loads(current['pinned']);pin=next((p for p in pins if p['id']==body.evidence_id),None)
   if not pin:raise HTTPException(422,'Улика должна быть на общей доске')
   old=c.execute('SELECT vote FROM board_votes WHERE code=? AND evidence=? AND role=?',(code,body.evidence_id,role)).fetchone()
   if not old or old['vote']!=body.vote:
    c.execute('INSERT INTO board_votes VALUES(?,?,?,?) ON CONFLICT(code,evidence,role) DO UPDATE SET vote=excluded.vote',(code,body.evidence_id,role,body.vote));label={'trust':'доверяет','doubt':'сомневается в','neutral':'снял оценку'}[body.vote];ev=event(json.loads(current['events']),role,'opinion',f'Детектив {role.upper()} {label}: {pin["title"]}');c.execute('UPDATE duo_rooms SET events=?,updated_at=? WHERE code=?',(json.dumps(ev,ensure_ascii=False),stamp(),code))
   c.execute('COMMIT')
  return {'ok':True}
 @router.post('/rooms/{code}/position')
 def position(code:str,body:Placement,request:Request):
  row,role=row_and_role(code,request);require_paid_stage(row)
  with db() as c:
   c.execute('BEGIN IMMEDIATE');current=c.execute('SELECT pinned,theories FROM duo_rooms WHERE code=?',(code,)).fetchone();ids={p['id'] for p in json.loads(current['pinned'])}|{t.get('id','') for t in json.loads(current['theories'])}
   if body.node not in ids:raise HTTPException(422,'Листа нет на доске')
   c.execute('INSERT INTO board_positions VALUES(?,?,?,?) ON CONFLICT(code,node) DO UPDATE SET x=excluded.x,y=excluded.y',(code,body.node,body.x,body.y));c.execute('COMMIT')
  return {'ok':True}
 @router.post('/rooms/{code}/review')
 def review(code:str,body:Review,request:Request):
  row,role=row_and_role(code,request);require_paid_stage(row)
  with db() as c:
   c.execute('BEGIN IMMEDIATE');current=c.execute('SELECT theories,events FROM duo_rooms WHERE code=?',(code,)).fetchone();theories=json.loads(current['theories']);t=next((t for t in theories if t.get('id')==body.theory_id),None)
   if not t:raise HTTPException(404,'Версия не найдена')
   reviews=t.setdefault('reviews',{});changed=reviews.get(role)!=body.decision;reviews[role]=body.decision;t['state']='agreed' if reviews.get('a')==reviews.get('b')=='agree' else 'disputed' if 'reject' in reviews.values() else 'review'
   ev=json.loads(current['events'])
   if changed:ev=event(ev,role,'review','Оба детектива поддержали версию' if t['state']=='agreed' else f'Детектив {role.upper()}: '+{'agree':'поддержал версию','recheck':'предложил перепроверить','reject':'не согласился с версией'}[body.decision])
   c.execute('UPDATE duo_rooms SET theories=?,events=?,updated_at=? WHERE code=?',(json.dumps(theories,ensure_ascii=False),json.dumps(ev,ensure_ascii=False),stamp(),code));c.execute('COMMIT')
  return {'ok':True,'state':t['state']}

 @router.post('/rooms/{code}/theory/evidence')
 def attach_evidence(code:str,body:TheoryEvidence,request:Request):
  row,role=row_and_role(code,request);require_paid_stage(row)
  with db() as c:
   c.execute('BEGIN IMMEDIATE');r=c.execute('SELECT theories,pinned,events FROM duo_rooms WHERE code=?',(code,)).fetchone();theories=json.loads(r['theories']);t=next((t for t in theories if t.get('id')==body.theory_id),None)
   if not t or body.evidence_id not in {p['id'] for p in json.loads(r['pinned'])}:raise HTTPException(422,'Выберите версию и общую улику')
   ids=t.setdefault('evidence_ids',[])
   if body.evidence_id not in ids:
    if len(ids)>=14:raise HTTPException(422,'В одной версии не больше 14 улик')
    ids.append(body.evidence_id);t['reviews']={};t['state']='review';ev=event(json.loads(r['events']),role,'review','В версию добавлена улика. Требуется новое согласие обоих игроков.')
    c.execute('UPDATE duo_rooms SET theories=?,events=?,updated_at=? WHERE code=?',(json.dumps(theories,ensure_ascii=False),json.dumps(ev,ensure_ascii=False),stamp(),code))
   c.execute('COMMIT')
  return {'ok':True}
 @router.post('/rooms/{code}/link/delete')
 def remove_link(code:str,body:RemoveLink,request:Request):
  row,role=row_and_role(code,request);require_paid_stage(row)
  with db() as c:
   c.execute('BEGIN IMMEDIATE');r=c.execute('SELECT links,events FROM duo_rooms WHERE code=?',(code,)).fetchone();before=json.loads(r['links']);after=[l for l in before if not ({l['source'],l['target']}=={body.source,body.target} and l['relation']==body.relation)]
   if len(before)!=len(after):
    ev=event(json.loads(r['events']),role,'link','Связь снята с общей доски');c.execute('UPDATE duo_rooms SET links=?,events=?,updated_at=? WHERE code=?',(json.dumps(after),json.dumps(ev,ensure_ascii=False),stamp(),code))
   c.execute('COMMIT')
  return {'ok':True}
