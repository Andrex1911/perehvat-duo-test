"""Secure-ish prototype multiplayer API: separate player tokens, server-side
puzzle verification, stage synchronization and team-score ledger.
No payments or personal data are collected in this beta.
"""
from __future__ import annotations
from ar_episode import init_ar, register_ar
from ar_relay import init_relay, register_relay
from unique_games import KINDS as GAME_KINDS, validate as validate_game
from social import init_social, account_id, bind_member, award, board_snapshot, register_routes
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from duo_cases import CASES, LEGACY_CASES, V5_CASES, V6_CASES, V7_CASES, V8_CASES, public_catalog, public_case

load_dotenv(Path(__file__).resolve().parent / '.env')
router = APIRouter(prefix='/api/duo')
DB_FILE = Path(__file__).resolve().parent / 'data' / 'duo.sqlite3'
DB_FILE.parent.mkdir(parents=True, exist_ok=True)
ENTITLEMENTS_DB = Path(__file__).resolve().parent / 'data' / 'perehvat.sqlite3'
DUO_PRICES = {'case': 99, 'bundle3': 259, 'season': 499}
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
TILES = ['✦', '◆', '●', '▲', '⬡']
GRID = 5


def stamp():
    return datetime.now(timezone.utc).isoformat()

def hash_token(t):
    return hashlib.sha256(t.encode('utf8')).hexdigest()

def js(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))

def load(s, fallback):
    try: return json.loads(s) if s else fallback
    except Exception: return fallback

def db():
    c = sqlite3.connect(DB_FILE, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA busy_timeout=15000')
    return c

def init():
    with db() as c:
        c.execute('''CREATE TABLE IF NOT EXISTS duo_rooms (
          code TEXT PRIMARY KEY, case_id TEXT NOT NULL, host_hash TEXT NOT NULL,
          guest_hash TEXT, stage INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
          tasks TEXT NOT NULL DEFAULT '{}', pinned TEXT NOT NULL DEFAULT '[]',
          links TEXT NOT NULL DEFAULT '[]', theories TEXT NOT NULL DEFAULT '[]',
          interrogated TEXT NOT NULL DEFAULT '[]', events TEXT NOT NULL DEFAULT '[]',
          verdict_a TEXT, verdict_b TEXT, wrong_attempts INTEGER NOT NULL DEFAULT 0,
          hint_uses INTEGER NOT NULL DEFAULT 0, verdict_misses INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, solved_at TEXT)''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_duo_leaderboard ON duo_rooms(done,solved_at)')
        cols={row[1] for row in c.execute('PRAGMA table_info(duo_rooms)')}
        if 'owner_sid' not in cols: c.execute('ALTER TABLE duo_rooms ADD COLUMN owner_sid TEXT')
        if 'story_version' not in cols: c.execute('ALTER TABLE duo_rooms ADD COLUMN story_version INTEGER NOT NULL DEFAULT 4')
        init_social(c)
        init_ar(c)
        init_relay(c)

init()


def case_for(row):
    return (CASES if row['story_version']>=9 else V8_CASES if row['story_version']==8 else V7_CASES if row['story_version']==7 else V6_CASES if row['story_version']==6 else V5_CASES if row['story_version']==5 else LEGACY_CASES)[row['case_id']]

def is_payments_live():
    return os.getenv('PAYMENT_MODE','demo').lower() == 'yookassa'


def access_for_room(row):
    # Existing beta rooms created without a session remain demo-only; production needs ownership.
    if not is_payments_live():
        return True
    owner=row['owner_sid'] if 'owner_sid' in row.keys() else None
    if not owner:
        return False
    try:
        with sqlite3.connect(ENTITLEMENTS_DB) as c:
            granted={r[0] for r in c.execute('SELECT product_id FROM entitlements WHERE sid=?',(owner,))}
    except sqlite3.Error:
        return False
    return f"duo_{row['case_id']}" in granted or 'duo_bundle3' in granted or 'duo_season' in granted


def payment_locked(row):
    return int(row['stage'])>=1 and not access_for_room(row)


def require_paid_stage(row):
    if payment_locked(row):
        raise HTTPException(402, 'Бесплатная глава завершена. Хозяин комнаты должен открыть полное дело в магазине.')


def code_valid(code):
    if not re.fullmatch(r'[A-Z2-9]{8}', code):
        raise HTTPException(422, 'Код комнаты должен содержать 8 символов')
    return code


def row_and_role(code, req):
    code_valid(code)
    with db() as c:
        row = c.execute('SELECT * FROM duo_rooms WHERE code=?', (code,)).fetchone()
    if row is None: raise HTTPException(404, 'Комната не найдена')
    token = req.headers.get('X-Coop-Token','')
    if not token or len(token) > 200: raise HTTPException(401, 'Нет ключа участника')
    h = hash_token(token)
    if hmac.compare_digest(h,row['host_hash']): return row,'a'
    if row['guest_hash'] and hmac.compare_digest(h,row['guest_hash']): return row,'b'
    raise HTTPException(403, 'Неверный ключ детектива')


def event(events, role, action, detail):
    events.append({'at':stamp(),'role':role,'action':action,'detail':detail[:160]})
    return events[-90:]


def progress_key(stage, role):
    return f'{stage}:{role}'


def matched_lines(board):
    hits=set()
    for y in range(GRID):
        for x in range(GRID):
            pos=y*GRID+x
            if x<=GRID-3 and board[pos]==board[pos+1]==board[pos+2]:
                hits.update((pos,pos+1,pos+2))
            if y<=GRID-3 and board[pos]==board[pos+GRID]==board[pos+2*GRID]:
                hits.update((pos,pos+GRID,pos+2*GRID))
    return hits


def possible_swaps(board):
    for i in range(GRID*GRID):
        for j in (i+1, i+GRID):
            if j>=GRID*GRID or (j==i+1 and i//GRID != j//GRID): continue
            if board[i]==board[j]: continue
            copy=board[:];copy[i],copy[j]=copy[j],copy[i]
            if matched_lines(copy):yield (i,j)


def board_for(code, stage, role, moves):
    seed = int(hashlib.sha256(f'{code}/{stage}/{role}/{moves}'.encode()).hexdigest()[:16],16)
    rng=random.Random(seed)
    for _ in range(300):
        board=[]
        for i in range(GRID*GRID):
            choices=[x for x in TILES if not (i%GRID>=2 and board[i-1]==board[i-2]==x)
                 and not (i//GRID>=2 and board[i-GRID]==board[i-2*GRID]==x)]
            board.append(rng.choice(choices))
        if any(possible_swaps(board)):
            return board
    raise RuntimeError('Cannot initialize game board')


def current_task_state(code, stage, role, tasks):
    key=progress_key(stage,role)
    t=tasks.get(key, {'done':False,'moves':0,'hits':[]})
    return t


# v7.7: scene-scoped AR clues are no longer optional minigames for new Room Zero rooms.
AR_STORY_STAGES = {2: ('mutual', 'Скрытый план'), 4: ('relay', 'Двойной перехват')}

def ar_gate_complete(c, code, stage):
    if stage == 2:
        solved={r['role'] for r in c.execute(
            'SELECT role FROM ar_progress WHERE code=? AND solved=1 AND cross_scanned=1',(code,))}
        return solved == {'a','b'}
    if stage == 4:
        row=c.execute('SELECT phase FROM ar_relay WHERE code=?',(code,)).fetchone()
        return bool(row and row['phase']>=3)
    return True

def required_ar_status(c, room):
    stage=int(room['stage'])
    if room['case_id']!='room_zero' or int(room['story_version'])<10 or stage not in AR_STORY_STAGES:
        return None
    kind,title=AR_STORY_STAGES[stage]
    complete=ar_gate_complete(c,room['code'],stage)
    return {'kind':kind,'title':title,'complete':complete,'stage':stage,
            'description': ('Сопоставьте два плана: каждый детектив направляет камеру на экран напарника и восстанавливает свой скрытый фрагмент.'
            if kind=='mutual' else 'Восстановите путь живого сигнала: А меняет каналы, Б сканирует маркеры камерой и передаёт параметры.')}

def advance_after_ar(c, code, expected_stage):
    """Called within AR writer transaction after the joint AR gate becomes complete."""
    room=c.execute('SELECT * FROM duo_rooms WHERE code=?',(code,)).fetchone()
    if not room or int(room['stage'])!=expected_stage or int(room['story_version'])<10:
        return False
    if room['case_id']!='room_zero' or not ar_gate_complete(c,code,expected_stage):
        return False
    tasks=load(room['tasks'],{})
    if not all(tasks.get(progress_key(expected_stage,r),{}).get('done') for r in ('a','b')):
        return False
    events=event(load(room['events'],[]),'system','stage',f'AR-улика подтверждена. Открыт этап {expected_stage+2}')
    c.execute('UPDATE duo_rooms SET stage=?,events=?,updated_at=? WHERE code=? AND stage=?',
              (expected_stage+1,js(events),stamp(),code,expected_stage))
    return True

def score(row):
    stage=int(row['stage'])
    wrong=int(row['wrong_attempts']); hints=int(row['hint_uses']); misses=int(row['verdict_misses'])
    pinned=load(row['pinned'],[]); links=load(row['links'],[])
    interviews=load(row['interrogated'],[]); theories=load(row['theories'],[])
    # Rewards for actual investigation work. Repeated actions are de-duplicated
    # in their respective handlers, and score is always recomputed on server.
    study_bonus=min(len(pinned),8)*12 + min(len(links),3)*20
    social_bonus=min(len(interviews),4)*15 + (25 if theories else 0)
    finish_bonus=24 if row['done'] else 0
    points=max(0,min(1000,140+85*min(stage,7)+study_bonus+social_bonus+finish_bonus-
                       25*wrong-40*hints-60*misses))
    tier='ЛЕГЕНДА' if points>=900 else 'ЗОЛОТО' if points>=750 else 'СЕРЕБРО' if points>=500 else 'БРОНЗА'
    elapsed=None
    if row['solved_at']:
        elapsed=round((datetime.fromisoformat(row['solved_at'])-datetime.fromisoformat(row['created_at'])).total_seconds()/60,1)
    achievements=[]
    if stage>=1:achievements.append('Первый след')
    if len(pinned)>=8:achievements.append('Коллекционеры улик')
    if len(links)>=2:achievements.append('Мастера дедукции')
    if row['done']:achievements.append('Дело закрыто')
    if row['done'] and wrong==0 and hints==0 and misses==0:achievements.append('Безупречная команда')
    return {'points':points,'tier':tier,'wrong':wrong,'hints':hints,'verdict_retries':misses,
            'pinned':len(pinned),'links':len(links),'interviews':len(interviews),
            'elapsed_minutes':elapsed,'achievements':achievements}


def status(row, role):
    case=case_for(row)
    stage=min(int(row['stage']),len(case['stages'])-1)
    d=public_case(row['case_id'],role,stage,case_for(row))
    # Narrative bridge is limited to v10 rooms. Earlier investigations keep their original prose.
    if row['case_id']=='room_zero' and int(row['story_version'])>=10:
        bridges={
            2:'На наших экранах — два несовместимых чертежа. Покажи свой документ напарнику и наведи камеру на его экран: под поверхностью проступит ещё один слой. Без него проход так и останется стеной.',
            4:'Один из нас управляет передатчиком, второй наводит камеру на его панель. Три канала — три проверки. Только они покажут, где заканчивается поддельный голос и начинается живой сигнал.'
        }
        if stage in bridges:
            d['intro'][-1]['text'] += ' ' + bridges[stage]
            d['prompt'] += ' ◈ Совместная AR-улика доступна непосредственно в задании этой главы.'
    tasks=load(row['tasks'],{})
    mine=current_task_state(row['code'],stage,role,tasks)
    peer=current_task_state(row['code'],stage,'b' if role=='a' else 'a',tasks)
    if d['task'] is not None and d['task']['kind']=='circuit':
        d['sync_shared']={'a':tasks.get(progress_key(stage,'a'),{}).get('hits',[]),
                          'b':tasks.get(progress_key(stage,'b'),{}).get('hits',[])}
    if d['task'] is not None:
        d['task']['done']=bool(mine.get('done'))
        d['task']['moves_done']=int(mine.get('moves',0))
        d['task']['hits']=mine.get('hits',[])
        if d['task']['kind']=='match3' and not mine.get('done'):
            d['task']['board']=board_for(row['code'],stage,role,int(mine.get('moves',0)))
    d.update({
      'story_version':row['story_version'],'code':row['code'],'role':role,'guest_joined':bool(row['guest_hash']),
      'waiting':not bool(row['guest_hash']),'done':bool(row['done']),
      'my_task_done':bool(mine.get('done')),'partner_task_done':bool(peer.get('done')),
      'updated_at':row['updated_at'],
      'pinned':load(row['pinned'],[]),'links':load(row['links'],[]),
      'theories':load(row['theories'],[]),'interrogated':load(row['interrogated'],[]),
      'events':load(row['events'],[])[-35:],
      'my_verdict':load(row['verdict_a' if role=='a' else 'verdict_b'],None),
      'partner_verdict_sent':bool(row['verdict_b' if role=='a' else 'verdict_a']),
      'stats':score(row),
    })
    with db() as conn:
        d.update(board_snapshot(conn,row['code']))
        d['required_ar']=required_ar_status(conn,row)
    if row['done']:
        d.update({'outcome':case['outcome'],'solution':case['solution']})
    locked=payment_locked(row)
    d['purchase_required']=locked
    d['purchase_product']=f"duo_{row['case_id']}"
    d['shop_prices']=DUO_PRICES
    d['demo']=not is_payments_live()
    if locked:
        # Never expose paid materials, answers or character testimony to a browser before payment.
        d.update({'evidence':[], 'witnesses':[], 'task':None,'scene':'Чтобы продолжить расследование, откройте полное дело.',
                  'prompt':'Бесплатный этап завершён. Хозяин комнаты открывает дело для обоих игроков.',
                  'stage_title':'РАСШИРЕННЫЙ ДОСТУП', 'kind':'paywall'})
        d.pop('sync_shared',None)
        d.pop('intro',None)
        d.pop('scene_art',None)
    return d


@router.get('/cases')
def catalog():
    return {'cases':public_catalog(),'mode':'online_two_players','free_demo':not is_payments_live(),'prices':DUO_PRICES}


class CreateRoom(BaseModel):
    case_id: str = Field(min_length=1,max_length=40)

@router.post('/rooms')
def create_room(body:CreateRoom,request:Request):
    if body.case_id not in CASES: raise HTTPException(404,'Дело не найдено')
    owner_sid=request.cookies.get('perehvat_v2_session')
    if is_payments_live():
        if not owner_sid or len(owner_sid)>128:raise HTTPException(401,'Нужно начать сессию перед созданием комнаты')
        with sqlite3.connect(ENTITLEMENTS_DB) as c:
            if not c.execute('SELECT 1 FROM sessions WHERE sid=?',(owner_sid,)).fetchone():
                raise HTTPException(401,'Сессия не найдена')
    token=secrets.token_urlsafe(32)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        for _ in range(10):
            code=''.join(secrets.choice(ALPHABET) for _ in range(8))
            try:
                c.execute('INSERT INTO duo_rooms(code,case_id,host_hash,created_at,updated_at,owner_sid,story_version) VALUES (?,?,?,?,?,?,?)',(code,body.case_id,hash_token(token),stamp(),stamp(),owner_sid,10 if body.case_id=='room_zero' else 9))
                break
            except sqlite3.IntegrityError: pass
        else: raise HTTPException(503,'Не удалось создать комнату')
        bind_member(c,code,'a',account_id(c,request))
        c.execute('COMMIT')
    return {'code':code,'token':token,'role':'a','case_id':body.case_id}

class JoinRoom(BaseModel):
    code: str = Field(min_length=8,max_length=8)

@router.post('/join')
def join(body:JoinRoom,request:Request):
    code=code_valid(body.code.strip().upper())
    token=secrets.token_urlsafe(32)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT case_id,guest_hash FROM duo_rooms WHERE code=?',(code,)).fetchone()
        if not row:
            c.execute('ROLLBACK');raise HTTPException(404,'Комната не найдена')
        if row['guest_hash']:
            c.execute('ROLLBACK');raise HTTPException(409,'В комнате уже два участника')
        bind_member(c,code,'b',account_id(c,request))
        events=event([], 'system','joined','Второй детектив подключился к расследованию.')
        c.execute('UPDATE duo_rooms SET guest_hash=?,events=?,updated_at=? WHERE code=?',(hash_token(token),js(events),stamp(),code))
        c.execute('COMMIT')
    return {'code':code,'token':token,'role':'b','case_id':row['case_id']}

@router.get('/rooms/{code}')
def read_room(code:str, request:Request):
    row,role=row_and_role(code,request)
    return status(row,role)

class Evidence(BaseModel):
    evidence_id: str = Field(min_length=5,max_length=35)

@router.post('/rooms/{code}/pin')
def pin(code:str,body:Evidence,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    stage=int(row['stage'])
    if stage>=7: raise HTTPException(409,'Улики уже собраны')
    allowed={x['id']:x for x in public_case(row['case_id'],role,stage,case_for(row))['evidence']}
    ev=allowed.get(body.evidence_id)
    if not ev: raise HTTPException(403,'Можно добавить только свою улику этого этапа')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute('SELECT pinned,events,stage FROM duo_rooms WHERE code=?',(code,)).fetchone()
        if cur['stage']!=stage: c.execute('ROLLBACK');return {'stale':True}
        pins=load(cur['pinned'],[])
        if not any(p['id']==ev['id'] for p in pins):
            pins.append({'id':ev['id'],'title':ev['title'],'body':ev['body'],'from':role,'stage':stage})
            evs=event(load(cur['events'],[]),role,'pin',f'Добавлена улика: {ev["title"]}')
            c.execute('UPDATE duo_rooms SET pinned=?,events=?,updated_at=? WHERE code=?',(js(pins),js(evs),stamp(),code))
        c.execute('COMMIT')
    return {'ok':True}

class Witness(BaseModel):
    witness_id: str = Field(min_length=5,max_length=35)

@router.post('/rooms/{code}/interrogate')
def interrogate(code:str,body:Witness,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    stage=int(row['stage'])
    if stage>=7 or body.witness_id!=f'{stage}:{role}:w0':raise HTTPException(403,'Нет доступа к свидетелю')
    name,testimony=case_for(row)['chapters'][stage]['witnesses'][role]
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute('SELECT interrogated,events,stage FROM duo_rooms WHERE code=?',(code,)).fetchone()
        if cur['stage']!=stage:c.execute('ROLLBACK');raise HTTPException(409,'Этап уже сменился')
        seen=load(cur['interrogated'],[])
        if body.witness_id not in seen:
            seen.append(body.witness_id)
            events=event(load(cur['events'],[]),role,'witness',f'Опрошен свидетель: {name}')
            c.execute('UPDATE duo_rooms SET interrogated=?,events=?,updated_at=? WHERE code=?',(js(seen),js(events),stamp(),code))
        c.execute('COMMIT')
    dialogue=case_for(row)['chapters'][stage].get('dialogues',{}).get(role,{'portrait':0,'questions':[{'id':'repeat','question':'Повторите показания','answer':testimony}]})
    return {'id':body.witness_id,'name':name,'testimony':testimony,**dialogue}

class Link(BaseModel):
    source_id:str=Field(min_length=5,max_length=35)
    target_id:str=Field(min_length=5,max_length=35)
    relation:str=Field(pattern='^(corroborates|contradicts|timeline)$')

@router.post('/rooms/{code}/link')
def link(code:str,body:Link,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute('SELECT pinned,links,events FROM duo_rooms WHERE code=?',(code,)).fetchone()
        ids={p['id'] for p in load(cur['pinned'],[])}
        if body.source_id not in ids or body.target_id not in ids or body.source_id==body.target_id:
            c.execute('ROLLBACK');raise HTTPException(422,'Нужны две разные улики на доске')
        links=load(cur['links'],[])
        identity={body.source_id,body.target_id}
        if not any({l['source'],l['target']}==identity and l['relation']==body.relation for l in links):
            if len(links)>=70: c.execute('ROLLBACK');raise HTTPException(429,'Максимум связей достигнут')
            links.append({'source':body.source_id,'target':body.target_id,'relation':body.relation,'from':role})
            evs=event(load(cur['events'],[]),role,'link','Новая связь между двумя доказательствами')
            c.execute('UPDATE duo_rooms SET links=?,events=?,updated_at=? WHERE code=?',(js(links),js(evs),stamp(),code))
        c.execute('COMMIT')
    return {'ok':True}

class Theory(BaseModel):
    text:str=Field(min_length=2,max_length=260)
    evidence_ids:list[str]=Field(default_factory=list,max_length=14)

@router.post('/rooms/{code}/theory')
def theory(code:str,body:Theory,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute('SELECT theories,events,pinned FROM duo_rooms WHERE code=?',(code,)).fetchone()
        theories=load(cur['theories'],[])
        if len(theories)>=60: c.execute('ROLLBACK');raise HTTPException(429,'Лимит версий')
        if not body.text.strip():raise HTTPException(422,'Введите текст версии')
        ids=set(body.evidence_ids);available={p['id'] for p in load(cur['pinned'],[])}
        if not ids<=available:raise HTTPException(422,'Версия может ссылаться только на общие улики')
        theories.append({'id':'theory-'+secrets.token_hex(6),'from':role,'text':body.text.strip(),'at':stamp(),'evidence_ids':sorted(ids),'reviews':{},'state':'review'})
        evs=event(load(cur['events'],[]),role,'theory','Выдвинута новая версия дела')
        c.execute('UPDATE duo_rooms SET theories=?,events=?,updated_at=? WHERE code=?',(js(theories),js(evs),stamp(),code))
        c.execute('COMMIT')
    return {'ok':True}

@router.post('/rooms/{code}/hint')
def hint(code:str,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    stage=int(row['stage'])
    if stage>=7: raise HTTPException(409,'Нет подсказок на вердикте')
    t=case_for(row)['chapters'][stage]['tasks'][role]
    if t['kind'] in GAME_KINDS: hint_text=t['_hint']
    elif t['kind']=='match3': hint_text='Поменяй местами две соседние фишки так, чтобы в ряду или столбце совпали три символа.'
    elif t['kind']=='spot': hint_text='Попроси напарника прочитать список символов в его личном материале.'
    elif t['kind']=='circuit': hint_text='Это общий электрический замок. Каждый управляет только своими тремя контактами, а правильную пару знает напарник.'
    elif t['kind']=='radio': hint_text='Настраивай ползунок, но точная частота записана у второго детектива.'
    elif t['kind']=='timeline': hint_text='У напарника есть полный порядок событий. Обсудите последовательность.'
    elif t['kind']=='route': hint_text='Нужные точки маршрута в правильном порядке записаны у напарника.'
    else:hint_text='Четырёхзначный ключ указан в документах второго детектива.'
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute('SELECT hint_uses,events FROM duo_rooms WHERE code=?',(code,)).fetchone()
        evs=event(load(cur['events'],[]),role,'hint','Использована подсказка (−40 очков)')
        c.execute('UPDATE duo_rooms SET hint_uses=hint_uses+1,events=?,updated_at=? WHERE code=?',(js(evs),stamp(),code))
        c.execute('COMMIT')
    return {'hint':hint_text,'cost':40}

class TaskAction(BaseModel):
    kind: str = Field(min_length=3,max_length=24)
    value: str = Field(default='',max_length=120)
    index: int | None = Field(default=None,ge=0,le=24)
    target: int | None = Field(default=None,ge=0,le=24)


def norm(s):
    return re.sub(r'[^A-ZА-Я0-9.]+','',str(s).upper().replace('Ё','Е'))

@router.post('/rooms/{code}/task')
def task_action(code:str,body:TaskAction,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    if not row['guest_hash']: raise HTTPException(409,'Нужен второй детектив')
    if row['done']:raise HTTPException(409,'Расследование уже завершено')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        current=c.execute('SELECT * FROM duo_rooms WHERE code=?',(code,)).fetchone()
        stage=int(current['stage'])
        if stage>=7: c.execute('ROLLBACK');raise HTTPException(409,'Пора вынести вердикт')
        if current['case_id']=='room_zero' and int(current['story_version'])>=10 and stage in AR_STORY_STAGES and not ar_gate_complete(c,code,stage):
            c.execute('ROLLBACK')
            raise HTTPException(409,'Сначала завершите совместную AR-улику этой главы: без неё дальнейшая головоломка недоступна.')
        definition=case_for(current)['chapters'][stage]['tasks'][role]
        if body.kind!=definition['kind']:
            c.execute('ROLLBACK');raise HTTPException(422,'Неверный тип мини-игры')
        tasks=load(current['tasks'],{})
        key=progress_key(stage,role)
        player=tasks.get(key,{'done':False,'moves':0,'hits':[]})
        if player.get('done'):
            c.execute('ROLLBACK');return {'ok':True,'already_done':True,'stage':stage}
        completed=False;correct=False;changed=False;penalty=0
        if definition['kind'] in GAME_KINDS:
            correct=validate_game(definition,body.value);completed=correct;changed=correct
            if not correct:penalty=25
        elif definition['kind']=='match3':
            a,b=body.index,body.target
            if a is None or b is None or (abs(a-b)!=GRID and not(abs(a-b)==1 and a//GRID==b//GRID)):
                c.execute('ROLLBACK');raise HTTPException(422,'Выберите две соседние фишки')
            board=board_for(code,stage,role,int(player.get('moves',0)))
            board[a],board[b]=board[b],board[a]
            if matched_lines(board):
                player['moves']=int(player.get('moves',0))+1
                changed=True;correct=True
                completed=player['moves']>=definition.get('goal',2)
            else:penalty=0  # No cost for trying match-three moves.
        elif definition['kind']=='circuit':
            if body.value not in definition['contacts'] or not body.value.startswith(role.upper()):
                c.execute('ROLLBACK');raise HTTPException(403,'Управлять можно только своими контактами')
            expected=set(definition['answer'].split(','))
            hits=set(player.get('hits',[]))
            if body.value in hits:
                c.execute('ROLLBACK');return {'ok':True,'already_marked':True,'stage':stage}
            if body.value in expected:
                hits.add(body.value);player['hits']=sorted(hits);correct=True;changed=True
                completed=len(hits)==len(expected)
            else:penalty=25
        elif definition['kind']=='spot':
            if body.value not in definition['symbols']:
                c.execute('ROLLBACK');raise HTTPException(422,'Неизвестный символ')
            expected=set(definition['answer'].split(','))
            hits=set(player.get('hits',[]))
            if body.value in hits:
                c.execute('ROLLBACK');return {'ok':True,'already_marked':True,'stage':stage}
            if body.value in expected:
                hits.add(body.value);player['hits']=sorted(hits);correct=True;changed=True
                completed=len(hits)==len(expected)
            else:penalty=25
        else:
            correct=norm(body.value)==norm(definition['answer'])
            completed=correct;changed=correct
            if not correct:penalty=25
        if completed: player['done']=True
        tasks[key]=player
        finished_a=bool(tasks.get(progress_key(stage,'a'),{}).get('done'))
        finished_b=bool(tasks.get(progress_key(stage,'b'),{}).get('done'))
        gate_needed=(current['case_id']=='room_zero' and int(current['story_version'])>=10 and stage in AR_STORY_STAGES)
        new_stage=stage + (1 if finished_a and finished_b and (not gate_needed or ar_gate_complete(c,code,stage)) else 0)
        events=load(current['events'],[])
        if changed:
            desc=(f'Завершена мини-игра «{definition["label"]}»' if completed else 'Найдена комбинация «3 в ряд»')
            events=event(events,role,'task',desc)
        elif penalty:
            events=event(events,role,'mistake','Неверная попытка (−25 очков)')
        if new_stage>stage: events=event(events,'system','stage',f'Детективы открыли этап {new_stage+1}')
        c.execute('UPDATE duo_rooms SET tasks=?,stage=?,wrong_attempts=wrong_attempts+?,events=?,updated_at=? WHERE code=?',
                  (js(tasks),new_stage,1 if penalty else 0,js(events),stamp(),code))
        c.execute('COMMIT')
    return {'ok':True,'correct':correct,'completed':completed,'stage':new_stage,'moves_done':player.get('moves',0),
            'hits':player.get('hits',[]),'penalty':penalty,'advanced':new_stage>stage}

class Verdict(BaseModel):
    suspect:str=Field(min_length=1,max_length=100)
    method:str=Field(min_length=1,max_length=160)
    motive:str=Field(min_length=1,max_length=160)

@router.post('/rooms/{code}/verdict')
def verdict(code:str,body:Verdict,request:Request):
    row,role=row_and_role(code,request)
    require_paid_stage(row)
    case=case_for(row)
    if not row['guest_hash']:raise HTTPException(409,'Нужны два детектива')
    if int(row['stage'])!=7:raise HTTPException(409,'Расследование ещё не завершено')
    if row['done']:return {'ok':True,'done':True}
    if body.suspect not in case['suspects'] or body.method not in case['methods'] or body.motive not in case['motives']:
        raise HTTPException(422,'Некорректная версия')
    answer=body.model_dump()
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        cur=c.execute('SELECT * FROM duo_rooms WHERE code=?',(code,)).fetchone()
        if cur['done']:c.execute('ROLLBACK');return {'ok':True,'done':True}
        column='verdict_a' if role=='a' else 'verdict_b'
        c.execute(f'UPDATE duo_rooms SET {column}=?,updated_at=? WHERE code=?',(js(answer),stamp(),code))
        current=c.execute('SELECT verdict_a,verdict_b,events FROM duo_rooms WHERE code=?',(code,)).fetchone()
        ready=bool(current['verdict_a'] and current['verdict_b']);done=False
        evs=event(load(current['events'],[]),role,'verdict','Детектив представил итоговый вердикт')
        if ready:
            a=load(current['verdict_a'],None);b=load(current['verdict_b'],None)
            if a==b==case['solution']:
                done=True
                evs=event(evs,'system','win','Дело раскрыто совместным решением')
                c.execute('UPDATE duo_rooms SET done=1,solved_at=? WHERE code=?',(stamp(),code))
            else:
                evs=event(evs,'system','retry','Вердикты не совпали или не подтвердились')
                c.execute('UPDATE duo_rooms SET verdict_misses=verdict_misses+1,verdict_a=NULL,verdict_b=NULL WHERE code=?',(code,))
        c.execute('UPDATE duo_rooms SET events=?,updated_at=? WHERE code=?',(js(evs),stamp(),code))
        if done:
            finished=c.execute('SELECT * FROM duo_rooms WHERE code=?',(code,)).fetchone()
            award(c,finished,score(finished))
        c.execute('COMMIT')
    return {'ok':True,'done':done,'retry':ready and not done,'waiting':not ready}

@router.get('/leaderboard')
def leaderboard():
    with db() as c:
        rows=c.execute('SELECT * FROM duo_rooms WHERE done=1 ORDER BY solved_at DESC LIMIT 300').fetchall()
    board=[]
    for row in rows:
        info=score(row)
        board.append({'team':'Команда •'+row['code'][-3:], 'case_id':row['case_id'],
                      'points':info['points'],'tier':info['tier'],'minutes':info['elapsed_minutes']})
    board.sort(key=lambda x:(-x['points'],x['minutes'] if x['minutes'] is not None else 99999))
    return {'ranking':board[:20],'notice':'Анонимизированные результаты тестовых команд. Очки пересчитываются на сервере.'}

register_routes(router,db,row_and_role,require_paid_stage,event,stamp,score)

register_ar(router,db,row_and_role,require_paid_stage,event,stamp,advance_after_ar)

register_relay(router,db,row_and_role,require_paid_stage,event,stamp,advance_after_ar)
