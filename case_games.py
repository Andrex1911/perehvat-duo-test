"""Nine distinct case-specific mechanics. Solutions and partner briefs stay private."""
import json, random
from collections import deque
KINDS={'echo','relay','mixer','forgery','stamp','provenance','snowpath','loadout','triangulate'}
def js(v):return json.dumps(v,separators=(',',':'))
def turn(bits,rotation,mirror):
 a=list(bits)
 if mirror:a=[a[y*3+2-x] for y in range(3) for x in range(3)]
 for _ in range(rotation):a=[a[(2-x)*3+y] for y in range(3) for x in range(3)]
 return a

def toggle(board,index):
 for j in range(9):
  if abs(j//3-index//3)+abs(j%3-index%3)<=1:board[j]^=1

def make(kind,n):
 rng=random.Random(7100+n);t={'kind':kind,'_hint':'Сравните данные панели с техническим приложением напарника.','_brief':''}
 if kind=='echo':
  seq=rng.sample(range(1,9),8);shift=rng.randint(1,7);target=seq[shift:]+seq[:shift]
  t.update(label='Фазовое совмещение эха',sequence=seq,help='Сдвигайте дорожку по кругу. Сопоставьте все восемь амплитуд с эталоном у напарника.',answer=str(shift),_brief='Эталон амплитуд слева направо: '+', '.join(map(str,target))+'. Передавайте форму сигнала, а не число сдвигов.')
 elif kind=='relay':
  moves=rng.sample(range(9),3+n%3);board=[0]*9
  for i in moves:toggle(board,i)
  t.update(label='Перекрёстные реле',board=board,help='Погасите все индикаторы. Реле меняет несколько ламп одновременно. Напарник знает схему воздействия.',answer=js(moves),_brief='Каждое нажатие переключает выбранную лампу и её соседей сверху, снизу, слева и справа. Диагонали не меняются. Повторное нажатие отменяет первое.')
 elif kind=='mixer':
  values=[rng.randint(1,5) for _ in range(3)];a,b,c=values;target=[a+b,b+c,a+c]
  t.update(label='Баланс трёх каналов',help='Регуляторы A, B, C влияют на пары измерителей. Получите показания, которые видит напарник.',answer=js(values),_brief=f'Целевые измерители: A+B = {target[0]}; B+C = {target[1]}; A+C = {target[2]}. Каждый регулятор от 0 до 6.')
 elif kind=='forgery':
  forged=set(rng.sample(range(4),2));rows=[]
  for i in range(4):rows.append({'name':['Дата','Получатель','Условие продажи','Подпись'][i],'ink':'синтетические' if i in forged else 'железогалловые','paper':'сетка 1894','pressure':str(2+i%2)})
  t.update(label='Спектральная экспертиза листа',rows=rows,help='Переключайте режимы осмотра. Отметьте только поздние добавления; потемнение и сила нажима сами по себе не доказывают подделку.',answer=js(sorted(forged)),_brief='Экспертный эталон: все строки оригинала написаны железогалловыми чернилами. Синтетические чернила — поздняя правка. Сетка бумаги и разный нажим не определяют возраст записи.')
 elif kind=='stamp':
  bits=[0]*9
  for i in rng.sample(range(9),4):bits[i]=1
  rotation=rng.randrange(4);mirror=rng.randrange(2);target=turn(bits,rotation,mirror)
  t.update(label='Совмещение сургучного оттиска',grid=bits,help='Поворачивайте и отражайте оттиск, пока расположение дефектов не совпадёт с описанием напарника.',answer=js([rotation,mirror]),_target=target,_brief='Эталон дефектов (■ дефект, · чисто), ряды сверху вниз: '+' / '.join(''.join('■' if x else '·' for x in target[y:y+3]) for y in (0,3,6))+'. Левый и правый края указаны со стороны читателя.')
 elif kind=='provenance':
  keys=rng.sample(['сова','лилия','якорь','лев'],4);dest=['Семейный архив','Нотариат','Музей','Курьерская служба'];order=rng.sample(range(4),4)
  t.update(label='Восстановление происхождения',documents=[{'name':f'Лист {i+1}','mark':keys[v]} for i,v in enumerate(order)],destinations=dest,help='Распределите документы по учреждениям. Каждое учреждение используйте один раз. У напарника — реестр водяных знаков.',answer=js(order),_brief='Реестр знаков: '+'; '.join(f'{keys[i]} — {dest[i]}' for i in range(4))+'. Порядок листов на вашем экране может отличаться.')
 elif kind=='snowpath':
  # Generate a guaranteed route, then require shortest safe path, not arbitrary clicking.
  blocked=set(rng.sample(range(1,24),6));queue=deque([[0]]);seen={0};path=None
  while queue:
   p=queue.popleft();i=p[-1]
   if i==24:path=p;break
   for j in range(25):
    if j not in blocked|seen and abs(i//5-j//5)+abs(i%5-j%5)==1:seen.add(j);queue.append(p+[j])
  if path is None:return make(kind,n+97)
  t.update(label='Маршрут через снежный фронт',size=5,start=0,finish=24,budget=len(path)-1,help='Ведите группу от А1 к Д5 по соседним клеткам без диагоналей. Карта опасных клеток у напарника. Один шаг расходует единицу топлива.',answer=js(path),_blocked=sorted(blocked),_brief='Непроходимые клетки: '+', '.join('АБВГД'[i//5]+str(i%5+1) for i in sorted(blocked))+'. На вашем экране нет маршрута: сообщайте препятствия, а путь детектив строит сам.')
 elif kind=='loadout':
  items=[{'name':'Печь','weight':4,'heat':6,'power':0},{'name':'Аккумулятор','weight':3,'heat':0,'power':6},{'name':'Термопакет','weight':2,'heat':3,'power':0},{'name':'Ручной генератор','weight':2,'heat':0,'power':3},{'name':'Комбимодуль','weight':5,'heat':4,'power':4},{'name':'Балласт','weight':3,'heat':0,'power':0}]
  heat,power=(6,3) if n%2 else (3,6);answer=[0,3] if n%2 else [1,2]
  t.update(label='Груз спасательной группы',items=items,capacity=6,help='Соберите оснащение не тяжелее 6 кг. Тепло и питание должны удовлетворить требованиям напарника. Лишний груз не даёт преимущества.',answer=js(answer),_needs=[heat,power],_brief=f'По погодному расчёту группе нужно не меньше {heat} единиц тепла и {power} единиц питания. Ограничение переноски — 6 кг. Выберите комплект, удовлетворяющий всем трём условиям.')
 else:
  target=rng.randrange(25);beacons=[0,4,20];dist=[abs(target//5-i//5)+abs(target%5-i%5) for i in beacons]
  t.update(label='Пересечение радиопеленгов',size=5,beacons=beacons,help='Найдите клетку пересечения трёх измерений. Расстояние здесь — сумма шагов по строке и столбцу, без диагоналей.',answer=str(target),_brief='Дальности по сетке: '+', '.join(f'маяк {"АБВГД"[p//5]}{p%5+1} = {d}' for p,d in zip(beacons,dist))+'. Только клетка, подходящая всем трём маякам, верна.')
 return t

def validate(t,value):
 try:
  v=json.loads(value)
  kind=t['kind']
  if kind in {'echo','triangulate'}:return type(v) is int and str(v)==t['answer']
  if not isinstance(v,list) or len(v)>30 or any(type(x) is not int for x in v):return False
  if kind=='relay':
   if any(x<0 or x>8 for x in v):return False
   board=t['board'].copy()
   for i in v:toggle(board,i)
   return not any(board)
  if kind=='stamp':return len(v)==2 and 0<=v[0]<4 and v[1] in (0,1) and turn(t['grid'],*v)==t['_target']
  if kind=='snowpath':return bool(v) and v[0]==0 and v[-1]==24 and len(v)-1<=t['budget'] and len(v)==len(set(v)) and all(0<=x<25 and x not in t['_blocked'] for x in v) and all(abs(a//5-b//5)+abs(a%5-b%5)==1 for a,b in zip(v,v[1:]))
  if kind=='loadout':
   if len(v)!=len(set(v)) or any(x<0 or x>=len(t['items']) for x in v):return False
   items=[t['items'][i] for i in v]
   return sum(x['weight'] for x in items)<=t['capacity'] and sum(x['heat'] for x in items)>=t['_needs'][0] and sum(x['power'] for x in items)>=t['_needs'][1]
  if kind=='forgery':return sorted(v)==json.loads(t['answer'])
  return v==json.loads(t['answer'])
 except (ValueError,TypeError,KeyError):return False

def apply_games(cases):
 families={'room_zero':['echo','relay','mixer'],'scarlet_letter':['forgery','stamp','provenance'],'white_route':['snowpath','loadout','triangulate']}
 purposes={'room_zero':['Выделите вход нулевой линии','Отделите живой отклик от петли','Проследите скрытое соединение','Восстановите архивный сигнал','Проверьте независимые отметки','Удержите резервную связь','Запитайте вентиляцию'], 'scarlet_letter':['Проверьте печать письма','Установите происхождение свидетельств','Разберите курьерскую доставку','Сопоставьте следы штампа','Выделите изменения завещания','Проверьте документы сделки','Сохраните подлинники'], 'white_route':['Определите безопасный подход','Подготовьте осмотр груза','Найдите отклонение от трассы','Проверьте точку перегрузки','Обойдите зону без связи','Подготовьте перехват у рампы','Выведите группу к контейнеру']}
 for ci,(cid,kinds) in enumerate(families.items()):
  c=cases[cid];c['content_version']='7.0'
  for stage,ch in enumerate(c['chapters']):
   for ri,role in enumerate(['a','b']):
    t=make(kinds[(stage+ri)%3],ci*100+stage*2+ri);t['label']=purposes[cid][stage]+' · '+t['label'];ch['tasks'][role]=t
   ch['brief']=purposes[cid][stage]+'. Обменяйтесь техническими приложениями: у каждого свой инструмент и данные для напарника.'
   for role in ['a','b']:
    peer='b' if role=='a' else 'a';ch['notes'][role]=ch['facts'][role]+'\n\nПРИЛОЖЕНИЕ ДЛЯ НАПАРНИКА\n'+ch['tasks'][peer]['_brief']
    for q in ch['dialogues'][role]['questions']:
     if q['id']=='connection':q['answer']='Сопоставьте наши материалы. В вашем документе есть отдельное приложение для напарника; оно относится к его прибору, не к вашему.'
  if cid=='room_zero':
   ch=c['chapters'][6];ch['scene']='Спасатели у синей двери. Вентиляция зависит от двух постов: на одном нужно отделить полезный сигнал от эха, на другом погасить аварийные реле. Общий свет включать нельзя. Обменяйтесь эталоном дорожки и схемой переключений. Старое предупреждение снова звучит — теперь вы понимаете, зачем оно было нужно.';ch['intro'][0]['text']=ch['scene'];ch['intro'][1]['text']='Я держу второй пост. Передаю данные твоего прибора и жду мои. Проверяем каждый шаг: спасатели готовы открыть дверь после восстановления двух постов.'
  else:
   ch=c['chapters'][6]
   ch['scene']=('Подлинник лежит под двойным дном. До передачи следователю восстановите происхождение листов и отделите поздние добавления от оригинала. У каждого детектива свой набор признаков.' if cid=='scarlet_letter' else 'Контейнер найден за воротами ретранслятора. Нужно провести группу через снежный фронт и подобрать оснащение для осмотра. Один видит местность, другой — погодные ограничения. Согласуйте действия до выхода.')
   ch['intro'][0]['text']=ch['scene']
  # Keep witness instructions consistent with the new instruments, not old locks.
  final=c['chapters'][6]
  speeches={
   'room_zero':{'a':'Я ведь предупреждал про свет. Если Семён просто подписал бы акт, никто бы сюда не приехал. Теперь ваши приборы покажут всё, что я пытался скрыть.','b':'Я держу второй пост. Передайте эталон моей дорожки или схему моих реле — что показывает ваш документ. Сначала сверим данные, потом включим вентиляцию.'},
   'scarlet_letter':{'a':'Оригинал под вторым дном. Я не смог его сжечь. Но прежде чем объявлять меня виновным, сравните бумагу и оттиск с реестром.','b':'Не перепутайте оригинал с копией при изъятии. Проверьте поздние чернила и расположение дефектов печати: каждый признак должен быть в протоколе.'},
   'white_route':{'a':'Контейнер за воротами, я покажу. Только не идите напрямик: под снегом промоина. Возьмите питание для терминала, иначе его не осмотреть.','b':'Я передам карту непроходимых клеток и требования по теплу и питанию. Сначала согласуем путь и оснащение. Затем выведем группу к грузу.'}}
  for role in ['a','b']:
   name,_=final['witnesses'][role];speech=speeches[cid][role];final['witnesses'][role]=(name,speech);final['dialogues'][role]['questions'][0]['answer']=speech
  if cid=='scarlet_letter':final['scene']='Подлинник лежит под двойным дном. До передачи следователю отделите поздние добавления от оригинала и сверьте расположение дефектов сургучной печати. У каждого детектива свой инструмент и эталон для напарника.';final['intro'][0]['text']=final['scene']
