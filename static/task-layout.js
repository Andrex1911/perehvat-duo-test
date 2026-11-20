'use strict';
window.TaskLayout={
 mount(box){
  if(!box || box.querySelector('.task-workspace'))return;
  const root=box.querySelector('.unique-instrument,.case-game');
  const make=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n};
  const workspace=make('div','task-workspace'),scroll=make('div','task-scroll'),footer=make('div','task-dock');
  const details=make('details','task-reference'),summary=make('summary','');summary.textContent='Инструкция и иллюстрация';details.append(summary);
  box.querySelectorAll('.mini-intro,.mini-help,.task-cinematic').forEach(n=>details.append(n));
  if(details.children.length>1)scroll.append(details);
  const status=box.querySelector('.task-order,.puzzle-status'),bar=box.querySelector('.task-toolbar');
  if(status){status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');footer.append(status);}
  if(bar)footer.append(bar);
  // Move the actual nodes, preserving game handlers and closure references.
  const live=root?.querySelector('.instrument-live');
  if(live){live.classList.add('task-preview');workspace.append(live);}
  while(box.firstChild)scroll.append(box.firstChild);
  // Older tasks have a single submit button instead of a toolbar.
  if(!bar)for(const n of [...scroll.children])if(n.matches('button.main-btn'))footer.append(n);
  scroll.tabIndex=0;scroll.setAttribute('aria-label','Игровое поле');
  workspace.append(scroll);if(footer.childElementCount)workspace.append(footer);
  box.append(workspace);
 },
 feedback(box,message){
  let n=box.querySelector('.task-feedback');
  if(!n){n=document.createElement('p');n.className='task-feedback';n.setAttribute('role','status');(box.querySelector('.task-dock')||box).prepend(n);}
  n.textContent=message;
 }
};
