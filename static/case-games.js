'use strict';
window.PerehvatGames={kinds:new Set(['echo','relay','mixer','forgery','stamp','provenance','snowpath','loadout','triangulate']),render(box,t,send){
 const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n};
 const button=(text,fn)=>{const b=node('button','task-option',text);b.type='button';b.onclick=fn;return b};
 const area=node('div','case-game '+t.kind),info=node('p','mini-help',t.help),board=node('div','game-workbench'),status=node('p','task-order');
 const bar=node('div','task-toolbar');let value,reset;
 const check=button('Подтвердить решение',()=>send(t.kind,{value:typeof value==='number'?String(value):JSON.stringify(value)}));check.classList.add('main-btn');bar.append(button('Начать заново',()=>reset()),check);area.append(info,board,status,bar);box.append(area);
 const cell=(text,fn,on=false)=>{const b=button(text,fn);b.classList.add('game-cell');b.setAttribute('aria-pressed',String(on));return b};
 const grid=()=>{board.className='game-workbench game-grid';board.style.setProperty('--columns',t.size||3)};
 function draw(){board.replaceChildren();
 if(t.kind==='echo'){
  const signal=node('div','echo-bars');const seq=t.sequence.slice(value).concat(t.sequence.slice(0,value));seq.forEach((n,i)=>{const b=node('div','echo-bar');b.style.setProperty('--level',n);b.append(node('span','',String(n)));b.setAttribute('aria-label',`Амплитуда ${i+1}: ${n}`);signal.append(b)});board.append(signal,button('← Сдвиг влево',()=>{value=(value+1)%8;draw()}),button('Сдвиг вправо →',()=>{value=(value+7)%8;draw()}));status.textContent='Сдвиг: '+value+' / 7. Сверьте всю дорожку с эталоном напарника.';
 }else if(t.kind==='relay'){
  grid();const lamps=[...t.board];value.forEach(i=>{for(let j=0;j<9;j++)if(Math.abs(Math.floor(i/3)-Math.floor(j/3))+Math.abs(i%3-j%3)<=1)lamps[j]^=1});lamps.forEach((v,i)=>board.append(cell(`${i+1} · ${v?'ВКЛ':'выкл'}`,()=>{if(value.includes(i))value=value.filter(x=>x!==i);else value.push(i);draw()},!!v)));status.textContent='Горящих ламп: '+lamps.filter(Boolean).length+'. Цель: 0.';
 }else if(t.kind==='mixer'){
  value.forEach((v,i)=>{const label=node('label','game-slider','Канал '+'ABC'[i]);const range=node('input');range.type='range';range.min=0;range.max=6;range.step=1;range.value=v;range.setAttribute('aria-label','Канал '+'ABC'[i]);const out=node('output','',v);range.oninput=()=>{value[i]=Number(range.value);out.textContent=range.value;meters()};label.append(range,out);board.append(label)});meters();
 }else if(t.kind==='forgery'){
  const lens=node('div','game-lenses');['Чернила','Бумага','Нажим'].forEach((x,i)=>{const b=button(x,()=>{area.dataset.lens=String(i);draw()});b.setAttribute('aria-pressed',String(Number(area.dataset.lens||0)===i));lens.append(b)});board.append(lens);t.rows.forEach((r,i)=>{const attr=['ink','paper','pressure'][Number(area.dataset.lens||0)];board.append(cell(r.name+' · '+r[attr],()=>{value=value.includes(i)?value.filter(x=>x!==i):[...value,i];draw()},value.includes(i)))});status.textContent='Отмечено поздних добавлений: '+value.length;
 }else if(t.kind==='stamp'){
  let bits=[...t.grid];if(value[1])bits=Array.from({length:9},(_,i)=>bits[Math.floor(i/3)*3+2-i%3]);for(let k=0;k<value[0];k++)bits=Array.from({length:9},(_,i)=>bits[(2-i%3)*3+Math.floor(i/3)]);
  const g=node('div','stamp-grid');bits.forEach((x,i)=>{const c=node('div',x?'stamp-mark filled':'stamp-mark',x?'●':'·');c.setAttribute('aria-label',`Ряд ${Math.floor(i/3)+1}, колонка ${i%3+1}: ${x?'дефект':'чисто'}`);g.append(c)});board.append(g,button('Повернуть на 90°',()=>{value[0]=(value[0]+1)%4;draw()}),button('Отразить исходный оттиск',()=>{value[1]^=1;draw()}));status.textContent=`Поворот: ${value[0]*90}°. Отражение: ${value[1]?'да':'нет'}.`;
 }else if(t.kind==='provenance'){
  t.documents.forEach((d,i)=>{const label=node('label','game-assignment',d.name+' · знак «'+d.mark+'»');const select=node('select');select.setAttribute('aria-label',d.name);const empty=node('option','','Выберите учреждение');empty.value='-1';select.append(empty);t.destinations.forEach((x,j)=>{const o=node('option','',x);o.value=j;select.append(o)});select.value=value[i];select.onchange=()=>{value[i]=Number(select.value);status.textContent='Распределено: '+value.filter(x=>x>=0).length+' / 4'};label.append(select);board.append(label)});status.textContent='Каждый знак соответствует одному учреждению. Повторения не допускаются.';
 }else if(t.kind==='snowpath'||t.kind==='triangulate'){
  grid();for(let i=0;i<25;i++){const label='АБВГД'[Math.floor(i/5)]+(i%5+1);const route=t.kind==='snowpath';const selected=route?value.includes(i):value===i;const marker=route?(i===0?' · СТАРТ':i===24?' · ЦЕЛЬ':''):(t.beacons.includes(i)?' · МАЯК':'');board.append(cell(label+marker,()=>{if(route){const last=value[value.length-1];if(value.length>1&&i===value[value.length-2])value.pop();else if(!value.includes(i)&&Math.abs(Math.floor(last/5)-Math.floor(i/5))+Math.abs(last%5-i%5)===1&&value.length-1<t.budget)value.push(i)}else value=i;draw()},selected))}status.textContent=t.kind==='snowpath'?`Шагов: ${value.length-1} / ${t.budget}. Для отмены шага нажмите предыдущую клетку. Путь: `+value.map(i=>'АБВГД'[Math.floor(i/5)]+(i%5+1)).join(' → '):value<0?'Сопоставьте три дальности из приложения напарника.':'Выбрано: '+'АБВГД'[Math.floor(value/5)]+(value%5+1);
 }else if(t.kind==='loadout'){
  t.items.forEach((x,i)=>board.append(cell(`${x.name} · ${x.weight} кг · тепло ${x.heat} · питание ${x.power}`,()=>{value=value.includes(i)?value.filter(x=>x!==i):[...value,i];draw()},value.includes(i))));const totals=value.reduce((a,i)=>{a[0]+=t.items[i].weight;a[1]+=t.items[i].heat;a[2]+=t.items[i].power;return a},[0,0,0]);status.textContent=`Вес ${totals[0]} / ${t.capacity} кг · тепло ${totals[1]} · питание ${totals[2]}. Требования у напарника.`;
 }
 }
 function meters(){status.textContent=`A+B: ${value[0]+value[1]} · B+C: ${value[1]+value[2]} · A+C: ${value[0]+value[2]}`}
 reset=()=>{value=({echo:0,relay:[],mixer:[0,0,0],forgery:[],stamp:[0,0],provenance:[-1,-1,-1,-1],snowpath:[0],loadout:[],triangulate:-1})[t.kind];draw()};reset();
}};
