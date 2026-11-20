'use strict';
window.UniqueGames={
render(box,t,send){
 const e=(tag,cls,text)=>{const x=document.createElement(tag);x.className=cls||'';if(text!==undefined)x.textContent=text;return x};
 const art=e('figure','task-cinematic');art.dataset.kind=t.kind;const frame=e('div','task-illustration');const idx=t.art_index||0;frame.style.backgroundImage=`url('/static/art/v6/tasks-${Math.floor(idx/6)}.webp')`;frame.style.backgroundPosition=`${idx%3*50}% ${Math.floor(idx%6/3)*100}%`;frame.setAttribute('role','img');frame.setAttribute('aria-label',t.label+' — иллюстрация');const cap=e('figcaption','',t.objective||t.label);art.append(frame,e('div','art-scan'),e('div','art-particles'),cap);box.append(art);
 const animate=()=>{if(document.body.dataset.fx==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;art.animate?.([{filter:'brightness(1)'},{filter:'brightness(1.15)'},{filter:'brightness(1)'}],{duration:650});};
 box.onclick=animate;box.oninput=animate;
 if(window.PerehvatGames.kinds.has(t.kind)){window.PerehvatGames.render(box,t,send);return;}
 const root=e('div','unique-instrument '+t.kind),help=e('p','mini-help',t.help),view=e('div','instrument-live'),board=e('div','instrument-controls'),status=e('div','task-order');status.setAttribute('aria-live','polite');const bar=e('div','task-toolbar');root.append(help,view,board,status,bar);box.append(root);let value,inspect=-1,preview=true;
 const btn=(label,fn)=>{const b=e('button','task-option',label);b.type='button';b.onclick=fn;return b};
 const render=()=>{board.replaceChildren();view.replaceChildren();const mode=t.mode;
 if(['sliders','vectors'].includes(mode))t.names.forEach((name,i)=>{const label=e('label','game-slider',name);const input=e('input');input.type='range';input.min=t.min||0;input.max=t.max;input.step=1;input.value=value[i];input.setAttribute('aria-label',name);const out=e('output','',value[i]);input.oninput=()=>{value[i]=Number(input.value);out.textContent=value[i];visual()};label.append(input,out);board.append(label)});
 if(mode==='assign')t.names.forEach((name,i)=>{const label=e('label','game-assignment',name),s=e('select');s.setAttribute('aria-label',name);const empty=e('option','','Выберите…');empty.value=-1;s.append(empty);t.options.forEach((o,j)=>{const x=e('option','',o);x.value=j;s.append(x)});s.value=value[i];s.onchange=()=>{value[i]=Number(s.value);visual()};label.append(s);board.append(label)});
 if(mode==='pair') [t.left,t.right].forEach((list,i)=>{const label=e('label','game-assignment',i?'Документ':'Утверждение'),s=e('select');s.setAttribute('aria-label',i?'Документ':'Утверждение');const empty=e('option','','Выберите…');empty.value=-1;s.append(empty);list.forEach((x,j)=>{const o=e('option','',x);o.value=j;s.append(o)});s.value=value[i];s.onchange=()=>{value[i]=Number(s.value);visual()};label.append(s);board.append(label)});
 if(mode==='dial'){const label=e('label','game-slider','Положение инструмента'),r=e('input');r.type='range';r.min=0;r.max=t.max;r.step=t.step||1;r.value=value;r.setAttribute('aria-label','Положение инструмента');r.oninput=()=>{value=Number(r.value);visual()};label.append(r);board.append(label);}
 if(mode==='inspect')t.names.forEach((name,i)=>{const b=btn(name,()=>{inspect=i;value=i;render()});b.setAttribute('aria-pressed',String(value===i));board.append(b)});
 if(['select','bits'].includes(mode))t.names.forEach((name,i)=>{const on=mode==='bits'?value[i]===1:value.includes(i);const b=btn(name+(mode==='bits'?' · '+(on?'1':'0'):''),()=>{if(mode==='bits')value[i]^=1;else value=value.includes(i)?value.filter(x=>x!==i):[...value,i];render()});b.setAttribute('aria-pressed',String(on));board.append(b)});
 if(['order','trace','memory'].includes(mode)){
  if(mode==='memory'){board.append(btn(preview?'Скрыть образец и повторить':'Показать образец',()=>{preview=!preview;render()}));if(preview)view.append(e('p','memory-sample',t.sample.map(i=>t.names[i]).join(' → ')));}
  t.names.forEach((name,i)=>{const b=btn(name,()=>{if(mode==='memory'&&preview)return;if(value[value.length-1]===i)value.pop();else if(!value.includes(i)&&value.length<(t.required||t.names.length))value.push(i);render()});b.setAttribute('aria-pressed',String(value.includes(i)));if(mode==='memory')b.disabled=preview;board.append(b)});
 }
 if(mode==='actions')t.names.forEach((name,i)=>board.append(btn(name,()=>{if(value.length<35)value.push(i);render()})));
 if(mode==='slide'){
  board.classList.add('fragment-board');const tiles=slide(value);tiles.forEach((v,i)=>{const b=btn(v?String(v):'Пусто',()=>{const current=slide(value),empty=current.indexOf(0);if(Math.abs(Math.floor(i/3)-Math.floor(empty/3))+Math.abs(i%3-empty%3)===1){value.push(i);render()}});b.disabled=!v;board.append(b)});
 }
 if(mode==='reveal'){
  t.angles.forEach((a,i)=>{const b=btn('Свет '+a,()=>{value[0]=i;render()});b.setAttribute('aria-pressed',String(value[0]===i));board.append(b)});
  t.words.forEach((word,i)=>{const b=btn(word,()=>{value[1]=i;render()});b.setAttribute('aria-pressed',String(value[1]===i));board.append(b)});
 }
 visual();
 };
 function slide(moves){const a=[...t.initial];moves.forEach(i=>{const z=a.indexOf(0);[a[z],a[i]]=[a[i],a[z]]});return a;}
 function gauge(name,level,max){const g=e('div','live-gauge'),fill=e('div','gauge-fill');fill.style.height=Math.max(0,Math.min(100,level/max*100))+'%';g.append(fill,e('span','',name+' '+level));return g;}
 function visual(){if(!(t.mode==='memory'&&preview))view.replaceChildren();let message='';
  if(t.mode==='sliders'||t.mode==='vectors'){value.forEach((v,i)=>view.append(gauge(t.names[i],v,t.max)));message=value.join(' · ');}
  if(t.kind==='gates'){const out=(value[0]||value[1])&&!value[2],check=value[0]^value[1];view.append(e('div','logic-output '+(out&&check?'lit':''),`Допуск ${Number(out)} · Проверка ${check}`));}
  if(t.kind==='wires'){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 300 120');svg.setAttribute('aria-label','Проложенные кабели');value.forEach((v,i)=>{if(v<0)return;const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',`M 12 ${15+i*30} C 130 ${15+i*30},170 ${15+v*30},288 ${15+v*30}`);p.setAttribute('stroke',['#5ee9ff','#ff7398','#c38dff','#f6c782'][i]);p.setAttribute('fill','none');p.setAttribute('stroke-width','4');svg.append(p)});view.append(svg);}
  if(t.kind==='pressure'){let a=0,b=0;for(const op of value){if(op===0)a=5;else if(op===1)b=3;else if(op===2)a=0;else if(op===3)b=0;else if(op===4){const d=Math.min(a,3-b);a-=d;b+=d}else{const d=Math.min(b,5-a);b-=d;a+=d}}view.append(gauge('Камера 5 л:',a,5),gauge('Камера 3 л:',b,3));message='Цель: 4 л в большой камере.';}
  if(t.kind==='thaw'){let heat=0,ice=0,invalid=false;value.forEach(x=>{if(x===0){heat+=3;ice+=2}else heat=Math.max(0,heat-2);if(heat>5)invalid=true});view.append(gauge('Нагрев',heat,5),gauge('Растопка',ice,6));message=invalid?'Перегрев в истории действий. Сбросьте и попробуйте с паузами.':'Нужно растопить 6 единиц, не превышая 5 тепла ни на одном шаге.';}
  if(t.kind==='convoy'){let boat=0,sides=[0,0,0],error=false;for(const x of value){if(x<3){if(sides[x]!==boat){error=true;break}sides[x]^=1}boat^=1;if((sides[0]===sides[1]&&sides[0]!==boat)||(sides[1]===sides[2]&&sides[1]!==boat)){error=true;break}}const river=e('div','river-scene');river.append(e('div','',sides.map((s,i)=>!s?t.names[i].replace('Везти ',''):'').filter(Boolean).join(' · ')),e('span','ferry '+(boat?'right':''),'⛴'),e('div','',sides.map((s,i)=>s?t.names[i].replace('Везти ',''):'').filter(Boolean).join(' · ')));view.append(river);message=error?'Опасная пара или груз на другом берегу. Начните заново.':'Проводник: '+(boat?'правый':'левый')+' берег.';}
  if(t.kind==='rescue'){const sequence=[1,3,0,4,2],valid=value.every((v,i)=>v===sequence[i]);view.append(e('div','logic-output '+(valid?'lit':''),valid?`Протокол: ${value.length}/5`:'Блокировка безопасности'));message=valid?'Проверьте следующий шаг у напарника.':'Нарушена блокировка. Начните заново.';}
  if(t.kind==='icebridge'){const weights=[4,2,3,3];const a=weights.reduce((s,w,i)=>s+(value[i]===0?w:0),0),b=weights.reduce((s,w,i)=>s+(value[i]===1?w:0),0);view.append(gauge('Сани А',a,6),gauge('Сани Б',b,6));}
  if(t.mode==='inspect'){const text=inspect<0?'Нажмите объект для осмотра.':t.details[inspect];view.append(e('div','inspection-result',text));message=inspect<0?'Объект ещё не выбран.':'Выбран: '+t.names[value];}
  if(t.kind==='sled'){const g=e('div','sled-grid');for(let i=0;i<15;i++){const y=Math.floor(i/3),x=i%3;g.append(e('span',(x===2&&(y===value||y===value+1))?'crate':y===2?'corridor':'',x===2&&(y===value||y===value+1)?'ЯЩИК':y===2?(x===0?'САНИ':'→'):'·'))}view.append(g);}
  if(t.kind==='schedule'){const timeline=e('div','power-timeline');value.forEach((start,i)=>{const row=e('div','power-row');for(let time=0;time<5;time++)row.append(e('span',time>=start&&time<start+[2,1,2][i]?'active':'',String(time)) );timeline.append(row)});view.append(timeline);}
  if(t.mode==='dial'&&t.kind!=='sled'){const dial=e('div','live-dial');dial.style.setProperty('--angle',(t.kind==='compass'?value:value*360/(t.max||1))+'deg');dial.append(e('span','dial-needle'),e('b','',t.display?.[value]??value));view.append(dial);message=t.kind==='sled'?'Проверьте, свободен ли ряд 3.':'Текущее положение: '+value;}
  if(t.mode==='reveal'){view.append(e('div','revealed-ink',['ПРОДАЖА','ЗАПРЕТ','неразборчиво','блик'][Math.max(0,value[0])]));message='Угол: '+(t.angles[value[0]]||'не выбран')+' · Чтение: '+(t.words[value[1]]||'не выбрано');}
  if(t.mode==='trace'){const points=[[15,90],[55,85],[40,15],[92,45]];const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 110 110');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',value.map((v,i)=>(i?'L':'M')+points[v].join(' ')).join(' '));p.setAttribute('stroke','#e9c28c');p.setAttribute('stroke-width','2');p.setAttribute('fill','none');svg.append(p);view.append(svg);}
  if(t.kind==='coverage'){for(let i=0;i<7;i++)view.append(e('span','coverage-dot '+(value.some(v=>Math.abs(v-i)<=1)?'lit':''),String(i+1)));message=`Маяков: ${value.length}/3`;}
  if(t.kind==='auction'){const cost=[4,5,6,1],worth=[7,8,6,3];message=`Цена ${value.reduce((s,i)=>s+cost[i],0)}/10 · ценность ${value.reduce((s,i)=>s+worth[i],0)}`;}
  if(['order','trace','memory','actions'].includes(t.mode)){const trail=value.map(i=>t.names[i]).join(' → ');status.textContent=(message?message+'\n':'')+(trail||'Последовательность ещё не начата.');}
  else status.textContent=message||('Выбрано: '+JSON.stringify(value));
 }
 function reset(){value=['sliders','vectors'].includes(t.mode)?t.names.map(()=>0):t.mode==='assign'?t.names.map(()=>-1):t.mode==='bits'?t.names.map(()=>0):['pair','reveal'].includes(t.mode)?[-1,-1]:['inspect','dial'].includes(t.mode)?(t.initial??(t.mode==='inspect'?-1:0)):[];inspect=-1;preview=true;render();}
 bar.append(btn('Начать заново',reset),btn('Подтвердить решение',()=>send(t.kind,{value:JSON.stringify(value)})));bar.lastChild.classList.add('main-btn');reset();
}};
