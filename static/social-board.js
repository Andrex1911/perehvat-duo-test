'use strict';
window.SocialBoard={busy:false,selected:new Set(),scale:.9,signature:'',current:null,
 render(container,r,api,refresh,toast,openDetail){
  this.current=r;if(this.busy)return;const signature=JSON.stringify([r.code,r.pinned,r.links,r.theories,r.opinions,r.positions,r.players]);if(this.signature===signature&&container.firstChild)return;this.signature=signature;
  const e=(tag,cls,text)=>{const x=document.createElement(tag);x.className=cls||'';if(text!==undefined)x.textContent=text;return x};
  const button=(text,fn,cls='quiet-btn')=>{const b=e('button',cls,text);b.type='button';b.onclick=fn;return b};
  const post=async(path,data)=>{try{await api(`/api/duo/rooms/${r.code}/${path}`,{method:'POST',body:JSON.stringify(data)});await refresh()}catch(err){toast(err.message)}};
  const old=container.querySelector('.board-viewport'),scroll=old?[old.scrollLeft,old.scrollTop]:[0,0];container.replaceChildren();container.className='thread-board';
  const tools=e('div','board-legend');tools.append(e('span','legend-a','А · '+(r.players?.a||'Детектив А')),e('span','legend-b','Б · '+(r.players?.b||'Детектив Б')));
  const caption=e('p','hint-small','Тяните булавку к другой улике или версии. За верхнюю полоску можно перемещать лист. На телефоне фон доски прокручивается пальцем. Для связи без перетаскивания нажмите две булавки.');
  const viewport=e('div','board-viewport'),space=e('div','board-space'),canvas=e('div','board-canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','Общая доска улик и версий');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('thread-lines');svg.setAttribute('aria-hidden','true');canvas.append(svg);space.append(canvas);viewport.append(space);
  const nodes=(r.pinned||[]).map(p=>({...p,type:'evidence'})).concat((r.theories||[]).map((t,i)=>({...t,id:t.id||'old-theory-'+i,type:'theory',title:'Версия команды',body:t.text})));
  const positions={};nodes.forEach((p,i)=>positions[p.id]=r.positions?.[p.id]||{x:20+(i%4)*270,y:35+Math.floor(i/4)*310});
  let height=Math.max(780,...Object.values(positions).map(p=>p.y+320));canvas.style.width='1140px';canvas.style.height=height+'px';svg.setAttribute('width','1140');svg.setAttribute('height',height);const cards=new Map();let source=null,preview=null,suppress=false;
  const size=()=>{canvas.style.transform=`scale(${this.scale})`;space.style.width=1140*this.scale+'px';space.style.height=height*this.scale+'px'};
  tools.append(button('−',()=>{this.scale=Math.max(.45,this.scale-.1);size()}),button('+',()=>{this.scale=Math.min(1.3,this.scale+.1);size()}),button('Обзор',()=>{this.scale=Math.max(.25,Math.min(1,viewport.clientWidth/1140));size()}));
  const path=(a,b,cls)=>{const p=document.createElementNS(svg.namespaceURI,'path');const dx=b.x-a.x;p.setAttribute('d',`M ${a.x} ${a.y} C ${a.x+dx*.25} ${a.y+65},${b.x-dx*.25} ${b.y+65},${b.x} ${b.y}`);p.setAttribute('class','evidence-thread '+cls);svg.append(p);return p};
  const anchor=id=>({x:positions[id].x+120,y:positions[id].y+17});
  const lines=()=>{svg.replaceChildren();(r.links||[]).forEach(l=>{if(positions[l.source]&&positions[l.target])path(anchor(l.source),anchor(l.target),l.relation)});(r.theories||[]).forEach(t=>(t.evidence_ids||[]).forEach(id=>{if(positions[id]&&positions[t.id])path(anchor(id),anchor(t.id),'theory-thread '+(t.state||'review'))}));};
  const connect=async(from,to)=>{if(!from||!to||from===to)return;const a=nodes.find(n=>n.id===from),b=nodes.find(n=>n.id===to);if(!a||!b)return;if(a.type==='theory'&&b.type==='theory'){toast('Версию связывают с уликой.');return;}if(a.type==='theory'||b.type==='theory'){const t=a.type==='theory'?a:b,p=a.type==='evidence'?a:b;await post('theory/evidence',{theory_id:t.id,evidence_id:p.id});}else{const relation=document.getElementById('linkRelation')?.value||'corroborates';await post('link',{source_id:from,target_id:to,relation});}};
  const logical=evt=>{const rect=canvas.getBoundingClientRect();return{x:(evt.clientX-rect.left)/this.scale,y:(evt.clientY-rect.top)/this.scale}};
  for(const p of nodes){
   const card=e('article','board-note role-'+p.from+' '+p.type+(p.state?' '+p.state:''));card.dataset.node=p.id;card.style.left=positions[p.id].x+'px';card.style.top=positions[p.id].y+'px';cards.set(p.id,card);
   const handle=button('⋮⋮ '+(r.players?.[p.from]||'Детектив '+p.from.toUpperCase()),()=>{},'note-drag');handle.setAttribute('aria-label','Переместить лист: '+p.title);handle.title='Перетащите или используйте стрелки клавиатуры';
   let start=null,offset=null;
   handle.onpointerdown=evt=>{if(evt.button!==0)return;this.busy=true;start=logical(evt);offset={...positions[p.id]};handle.setPointerCapture?.(evt.pointerId);evt.preventDefault()};
   handle.onpointermove=evt=>{if(!start)return;const xy=logical(evt);positions[p.id]={x:Math.max(0,Math.min(900,offset.x+xy.x-start.x)),y:Math.max(0,Math.min(height-290,offset.y+xy.y-start.y))};card.style.left=positions[p.id].x+'px';card.style.top=positions[p.id].y+'px';lines()};
   handle.onpointerup=async()=>{if(!start)return;start=null;this.busy=false;await post('position',{node:p.id,...positions[p.id]})};handle.onpointercancel=()=>{if(offset){positions[p.id]=offset;card.style.left=offset.x+'px';card.style.top=offset.y+'px';lines()}start=null;this.busy=false};
   handle.onkeydown=async evt=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[evt.key];if(!delta)return;evt.preventDefault();const pos=positions[p.id];await post('position',{node:p.id,x:Math.max(0,Math.min(900,pos.x+delta[0])),y:Math.max(0,Math.min(7000,pos.y+delta[1]))})};
   const pin=button('●',()=>{if(suppress)return;if(!source){source=p.id;pin.classList.add('chosen');toast('Теперь нажмите булавку второго листа.')}else{const from=source;source=null;canvas.querySelectorAll('.chosen').forEach(n=>n.classList.remove('chosen'));connect(from,p.id)}},'thread-pin');pin.setAttribute('aria-label','Протянуть нить: '+p.title);let beginning=null,moved=false;
   pin.onpointerdown=evt=>{if(evt.button!==0)return;beginning=logical(evt);moved=false;this.busy=true;pin.setPointerCapture?.(evt.pointerId)};
   pin.onpointermove=evt=>{if(!beginning)return;const pt=logical(evt);moved=Math.hypot(pt.x-beginning.x,pt.y-beginning.y)>5;if(moved){preview?.remove();preview=path(anchor(p.id),pt,'draft-thread')}};
   pin.onpointerup=async evt=>{if(!beginning)return;beginning=null;preview?.remove();preview=null;this.busy=false;if(moved){suppress=true;setTimeout(()=>{suppress=false},100);const dest=document.elementFromPoint(evt.clientX,evt.clientY)?.closest('.board-note');source=null;await connect(p.id,dest?.dataset.node)}};
   pin.onpointercancel=()=>{beginning=null;preview?.remove();this.busy=false};
   card.append(handle,pin,e('h4','',p.title));
   const brief=(p.body||'').split(/\n\n(?:ПРИЛОЖЕНИЕ|ТЕХНИЧЕСКОЕ|ДАННЫЕ)/)[0];card.append(e('p','note-excerpt',brief.slice(0,135)+(brief.length>135?'…':'')),button('Открыть лист',()=>openDetail(p),'note-read'));
   if(p.type==='evidence'){
    const opinions=r.opinions?.[p.id]||{};card.append(e('small','opinion-summary',['a','b'].map(role=>role.toUpperCase()+': '+({trust:'верит',doubt:'сомневается',neutral:'без оценки'}[opinions[role]]||'без оценки')).join(' · ')));
    const voteRow=e('div','note-actions');[['trust','Верю'],['doubt','Сомневаюсь'],['neutral','Снять']].forEach(([vote,label])=>{const b=button(label,()=>post('opinion',{evidence_id:p.id,vote}),'note-vote');b.setAttribute('aria-pressed',String(opinions[r.role]===vote));voteRow.append(b)});card.append(voteRow);
    const label=e('label','version-select'),check=e('input');check.type='checkbox';check.checked=this.selected.has(p.id);check.onchange=()=>{if(check.checked)this.selected.add(p.id);else this.selected.delete(p.id)};label.append(check,document.createTextNode(' В новую версию'));card.append(label);
   }else{
    card.append(e('small','opinion-summary',p.state==='agreed'?'✓ Поддержали оба — гипотеза команды':p.state==='disputed'?'Есть возражение':'Ожидает совместной проверки'));
    const review=e('div','note-actions');if(p.id.startsWith('theory-'))[['agree','Согласен'],['recheck','Проверить'],['reject','Не согласен']].forEach(([decision,label])=>{const b=button(label,()=>post('review',{theory_id:p.id,decision}),'note-vote');b.setAttribute('aria-pressed',String(p.reviews?.[r.role]===decision));review.append(b)});card.append(review);
   }
   canvas.append(card);
  }
  if(!nodes.length)canvas.append(e('p','board-empty','Добавьте улики из материалов дела. Здесь появятся листы обоих детективов.'));
  container.append(tools,caption,viewport);size();lines();viewport.scrollLeft=scroll[0];viewport.scrollTop=scroll[1];
 },
 clear(){this.signature='';this.current=null;this.selected.clear();}
};
