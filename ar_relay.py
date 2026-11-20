"""Asymmetric camera task: A operates the display, B observes hidden readings."""
import json
from fastapi import Request, HTTPException
from pydantic import BaseModel, Field

# Each phase has exactly one matching relay. Private tables never go to A.
PHASES=[
 {'goal':'Найдите канал 144 МГц с вертикальной поляризацией.', 'target':3,
  'readings':{1:['144 МГц','горизонтальная'],2:['162 МГц','вертикальная'],3:['144 МГц','вертикальная'],4:['120 МГц','горизонтальная']}},
 {'goal':'Найдите канал с задержкой 20 мс и фазой 90°.', 'target':1,
  'readings':{1:['20 мс','фаза 90°'],2:['20 мс','фаза 180°'],3:['40 мс','фаза 90°'],4:['60 мс','фаза 0°']}},
 {'goal':'Найдите канал с усилением 6 дБ и контрольной меткой «СЕВЕР».', 'target':4,
  'readings':{1:['6 дБ','метка ЮГ'],2:['3 дБ','метка СЕВЕР'],3:['9 дБ','метка ЗАПАД'],4:['6 дБ','метка СЕВЕР']}},
]

def init_relay(c):
 c.execute("CREATE TABLE IF NOT EXISTS ar_relay(code TEXT PRIMARY KEY,phase INTEGER NOT NULL DEFAULT 0,selected INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,scans TEXT NOT NULL DEFAULT '[]')")

class Selection(BaseModel):
 channel:int=Field(ge=1,le=4)
 revision:int=Field(ge=0)
class Scan(BaseModel):
 marker:str=Field(min_length=1,max_length=50)
 revision:int=Field(ge=0)
class Confirm(BaseModel):revision:int=Field(ge=0)

def register_relay(router,db,row_and_role,require_paid_stage,event,stamp,advance_after_ar=None):
 def permitted(code,request,only=None):
  room,role=row_and_role(code,request)
  if only and role!=only:raise HTTPException(403,'Это действие выполняет детектив '+only.upper())
  earliest=4 if int(room['story_version'])>=10 else 1
  if room['case_id']!='room_zero' or room['story_version']<8 or room['stage']<earliest:
   raise HTTPException(409,'Двойной перехват появится в главе «Время, которого не было».')
  require_paid_stage(room)
  if not room['guest_hash']:raise HTTPException(409,'Нужны оба детектива.')
  return role
 def get(c,code):
  c.execute('INSERT OR IGNORE INTO ar_relay(code) VALUES(?)',(code,))
  return c.execute('SELECT * FROM ar_relay WHERE code=?',(code,)).fetchone()
 def public(row,role):
  done=row['phase']>=3;scans=json.loads(row['scans'])
  common={'role':role,'phase':row['phase'],'revision':row['revision'],'selected':row['selected'],'complete':done,'scanned_channels':scans}
  if role=='a':return {**common,'goal':None if done else PHASES[row['phase']]['goal'],'marker_image':f'/static/ar/relay-{row["selected"]}.png'}
  return {**common,'readings':{} if done else {str(k):PHASES[row['phase']]['readings'][k] for k in scans}}
 def fresh(row,revision):
  if row['revision']!=revision:raise HTTPException(409,'Панель изменилась. Дождитесь обновления и повторите действие.')
 @router.get('/rooms/{code}/ar-relay')
 def status(code:str,request:Request):
  role=permitted(code,request)
  with db() as c:return public(get(c,code),role)
 @router.post('/rooms/{code}/ar-relay/select')
 def select(code:str,body:Selection,request:Request):
  role=permitted(code,request,'a')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');row=get(c,code);fresh(row,body.revision)
   if row['phase']>=3:raise HTTPException(409,'Перехват уже завершён.')
   if row['selected']!=body.channel:c.execute('UPDATE ar_relay SET selected=?,revision=revision+1 WHERE code=?',(body.channel,code))
   result=public(get(c,code),role);c.execute('COMMIT');return result
 @router.post('/rooms/{code}/ar-relay/scan')
 def scan(code:str,body:Scan,request:Request):
  role=permitted(code,request,'b')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');row=get(c,code);fresh(row,body.revision)
   if row['phase']>=3:raise HTTPException(409,'Перехват уже завершён.')
   if body.marker!=f'PEREHVAT:RELAY:V1:{row["selected"]}':raise HTTPException(422,'Наведите камеру на текущий канал на экране напарника.')
   scans=json.loads(row['scans'])
   if row['selected'] not in scans:
    scans.append(row['selected']);c.execute('UPDATE ar_relay SET scans=? WHERE code=?',(json.dumps(scans),code))
   result=public(get(c,code),role);c.execute('COMMIT');return result
 @router.post('/rooms/{code}/ar-relay/confirm')
 def confirm(code:str,body:Confirm,request:Request):
  role=permitted(code,request,'a')
  with db() as c:
   c.execute('BEGIN IMMEDIATE');row=get(c,code)
   if row['phase']>=3:c.execute('COMMIT');return {**public(row,role),'correct':True}
   fresh(row,body.revision)
   if row['selected'] not in json.loads(row['scans']):raise HTTPException(409,'Сначала детектив Б должен осмотреть этот канал камерой.')
   correct=row['selected']==PHASES[row['phase']]['target']
   if correct:
    c.execute("UPDATE ar_relay SET phase=phase+1,revision=revision+1,scans='[]' WHERE code=?",(code,))
    room=c.execute('SELECT pinned,events FROM duo_rooms WHERE code=?',(code,)).fetchone();pins=json.loads(room['pinned']);events=json.loads(room['events'])
    events=event(events,'a','ar',f'Двойной перехват: согласован контур {row["phase"]+1} из 3')
    if row['phase']==2:
     for who,title,bodytext in [('a','AR: цепочка радиоканалов','Три согласованных настройки связали каналы передатчика в устойчивый маршрут сигнала.'),('b','AR: скрытая метка СЕВЕР','Камерой обнаружены скрытые параметры и сервисная метка СЕВЕР. Сигнал проходит через настроенный передатчик, а не возникает сам по себе.')]:
      pid='ar:relay:'+who
      if not any(p['id']==pid for p in pins):pins.append({'id':pid,'from':who,'title':title,'body':bodytext,'stage':1})
     events=event(events,'system','ar','Двойной перехват завершён. Две улики добавлены на доску.')
    c.execute('UPDATE duo_rooms SET pinned=?,events=?,updated_at=? WHERE code=?',(json.dumps(pins,ensure_ascii=False),json.dumps(events,ensure_ascii=False),stamp(),code))
    if row['phase']==2 and advance_after_ar:
     advance_after_ar(c,code,4)
   result=public(get(c,code),role);c.execute('COMMIT');return {**result,'correct':correct}
