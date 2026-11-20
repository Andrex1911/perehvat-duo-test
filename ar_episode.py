"""Optional two-person marker AR investigation; no camera images leave the device."""
import json
from fastapi import Request, HTTPException
from pydantic import BaseModel, Field

def init_ar(c):
    c.execute('CREATE TABLE IF NOT EXISTS ar_progress(code TEXT,role TEXT,revealed INTEGER DEFAULT 0,solved INTEGER DEFAULT 0,PRIMARY KEY(code,role))')
    # v7.4: прежний screen-reveal не является подтверждённым взаимным сканированием.
    cols={x[1] for x in c.execute('PRAGMA table_info(ar_progress)')}
    if 'cross_scanned' not in cols:
        c.execute('ALTER TABLE ar_progress ADD COLUMN cross_scanned INTEGER NOT NULL DEFAULT 0')

class Scan(BaseModel):
    marker:str=Field(min_length=10,max_length=90)
class Answer(BaseModel):
    value:str=Field(min_length=1,max_length=16)

CLUES={
 'a': {'title':'Слой А · План техэтажа','prompt':'Спросите напарника, каким знаком отмечено скрытое помещение. Найдите его код на плане и передайте напарнику номер кабеля.',
       'lines':['R1 · КРУГ · кабель 31','R2 · КВАДРАТ · кабель 47','R3 · ТРЕУГОЛЬНИК · кабель 62','R4 · РОМБ · кабель 85'],
       'options':['R1','R2','R3','R4'],'question':'Код скрытого помещения'},
 'b': {'title':'Слой Б · Сервисный журнал','prompt':'Сообщите напарнику знак из журнала. Узнайте номер кабеля найденного помещения и определите сервисный порт.',
       'lines':['Скрытая комната: ТРЕУГОЛЬНИК','Кабель 31 → порт K2','Кабель 47 → порт K1','Кабель 62 → порт K4','Кабель 85 → порт K3'],
       'options':['K1','K2','K3','K4'],'question':'Порт скрытого помещения'},
}

def result_stage_is_integrated(c,code,stage):
    room=c.execute('SELECT story_version,stage FROM duo_rooms WHERE code=?',(code,)).fetchone()
    return bool(room and int(room['story_version'])>=10 and int(room['stage'])==stage)

def register_ar(router,db,row_and_role,require_paid_stage,event,stamp,advance_after_ar=None):
    def permitted(code,request):
        row,role=row_and_role(code,request)
        if row['case_id']!='room_zero' or row['story_version']<8:
            raise HTTPException(409,'AR-эпизод доступен в «Квартире 0» с сюжетом версии 8.')
        if row['stage'] < (2 if int(row['story_version'])>=10 else 1):
            raise HTTPException(409,'Скрытый план проявится в главе «Лестница, которой нет».')
        require_paid_stage(row)
        if not row['guest_hash']:raise HTTPException(409,'Для эпизода нужны оба детектива.')
        return row,role
    def snapshot(c,code,role):
        rows={r['role']:dict(r) for r in c.execute('SELECT * FROM ar_progress WHERE code=?',(code,))}
        mine=rows.get(role,{})
        return {'role':role,'revealed':bool(mine.get('cross_scanned')),'solved':bool(mine.get('solved')),
                'partner_scanned':bool(rows.get('b' if role=='a' else 'a',{}).get('cross_scanned')),
                'partner_solved':bool(rows.get('b' if role=='a' else 'a',{}).get('solved')),
                'complete':all(rows.get(k,{}).get('solved') for k in ['a','b']),
                'marker':'PEREHVAT:PLAN:V1:'+role.upper(),
                'target_marker':'PEREHVAT:PLAN:V1:'+('B' if role=='a' else 'A'),
                'marker_image':'/static/ar/card-'+role+'.png',
                'clue':CLUES[role] if mine.get('revealed') else None}
    @router.get('/rooms/{code}/ar')
    def state(code:str,request:Request):
        _,role=permitted(code,request)
        with db() as c:return snapshot(c,code,role)
    @router.post('/rooms/{code}/ar/scan')
    def scan(code:str,body:Scan,request:Request):
        _,role=permitted(code,request)
        expected='PEREHVAT:PLAN:V1:'+('B' if role=='a' else 'A')
        if body.marker != expected:
            raise HTTPException(409,'Это не экран напарника. Наведите камеру на маркер другой роли.')
        with db() as c:
            c.execute('INSERT INTO ar_progress(code,role,revealed,cross_scanned) VALUES(?,?,1,1) ON CONFLICT(code,role) DO UPDATE SET revealed=1,cross_scanned=1',(code,role))
            return snapshot(c,code,role)
    @router.post('/rooms/{code}/ar/reveal')
    def legacy_reveal(code:str,request:Request):
        permitted(code,request)
        raise HTTPException(410,'В версии 7.4 скрытый слой открывается только при сканировании экрана напарника.')
    @router.post('/rooms/{code}/ar/answer')
    def answer(code:str,body:Answer,request:Request):
        _,role=permitted(code,request)
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            mine=c.execute('SELECT * FROM ar_progress WHERE code=? AND role=?',(code,role)).fetchone()
            if not mine or not mine['cross_scanned']:raise HTTPException(409,'Сначала отсканируйте экран напарника своей камерой.')
            right=body.value.strip().upper()=={'a':'R3','b':'K4'}[role]
            if right and not mine['solved']:
                c.execute('UPDATE ar_progress SET solved=1 WHERE code=? AND role=?',(code,role))
                row=c.execute('SELECT pinned,events FROM duo_rooms WHERE code=?',(code,)).fetchone()
                events=event(json.loads(row['events']),role,'ar','Детектив '+role.upper()+' проверил свою часть скрытого плана')
                pins=json.loads(row['pinned'])
                if snapshot(c,code,role)['complete']:
                    for who,title,bodytext in [('a','AR: скрытое помещение R3','На наложенном плане обнаружена комната R3 со знаком треугольника и кабелем 62.'),('b','AR: сервисный порт K4','Сервисный журнал связывает кабель 62 с портом K4. Два документа подтверждают скрытый технический доступ.')]:
                        if not any(p['id']=='ar:plan:'+who for p in pins):pins.append({'id':'ar:plan:'+who,'title':title,'body':bodytext,'from':who,'stage':1})
                    events=event(events,'system','ar','Скрытый план восстановлен вдвоём. Две улики добавлены на доску.')
                c.execute('UPDATE duo_rooms SET pinned=?,events=?,updated_at=? WHERE code=?',(json.dumps(pins,ensure_ascii=False),json.dumps(events,ensure_ascii=False),stamp(),code))
                if advance_after_ar and result_stage_is_integrated(c,code,2):
                    advance_after_ar(c,code,2)
            result=snapshot(c,code,role);c.execute('COMMIT')
            return {**result,'correct':right or bool(mine['solved'])}
