'use strict';
window.RelayAR={dispose:null,
 async open(host,code,api,refresh){
  this.dispose?.();let dead=false,state=null,stream=null,serial=0,raf=0,timer=0,busy=false,polling=false,scanning=false,retryAt=0;
  const e=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n};
  const button=(text,fn)=>{const n=e('button','outline-btn',text);n.type='button';n.onclick=fn;return n};
  const base='/api/duo/rooms/'+code+'/ar-relay',post=(path,body)=>api(base+'/'+path,{method:'POST',body:JSON.stringify(body)});
  const title=e('h2','','Двойной перехват'),intro=e('p','hint-small'),progress=e('p','relay-progress'),notice=e('p','ar-notice','Подключаем панель…');notice.setAttribute('role','status');
  const stage=e('div','relay-stage'),controls=e('div','relay-controls'),goal=e('p','relay-goal'),display=e('img','relay-marker');display.alt='Панель канала для камеры напарника';
  const canvas=e('canvas','ar-viewport'),video=e('video','ar-video-source');canvas.width=640;canvas.height=400;canvas.setAttribute('aria-label','AR-показания выбранного радиоканала');video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');
  const readings=e('p','relay-readings','Показания появятся после осмотра камерой.'),history=e('details','relay-history'),summary=e('summary','','Прочитанные каналы этого контура'),historyList=e('ul');history.append(summary,historyList);
  const stop=()=>{serial++;cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;if(start)start.disabled=!!state?.complete;};
  const hide=()=>{if(document.hidden){stop();notice.textContent='Камера остановлена. Включите её, чтобы продолжить.';}};
  let start=null,confirm=null,ctx=null;const choices=[];
  this.dispose=()=>{if(dead)return;dead=true;stop();clearInterval(timer);document.removeEventListener('visibilitychange',hide);};document.addEventListener('visibilitychange',hide);
  host.className='ar-episode relay-episode';host.replaceChildren(title,intro,progress,stage,notice,controls);
  async function poll(){if(dead||polling)return;polling=true;try{const next=await api(base);if(!dead)apply(next);}catch(err){if(!dead)notice.textContent='Нет связи: '+err.message;}finally{polling=false;}}
  function apply(next){
   if(state&&next.revision<state.revision)return;const changed=state&&next.revision!==state.revision,completed=!state?.complete&&next.complete;state=next;
   progress.textContent=next.complete?'✓ Все три контура согласованы':`Контур ${next.phase+1} из 3 · Канал ${next.selected}`;
   if(next.role==='a'){
    goal.textContent=next.complete?'Сигнал восстановлен. На общей доске появились две улики.':next.goal;
    if(display.getAttribute('src')!==next.marker_image)display.src=next.marker_image;
    choices.forEach((b,i)=>{b.disabled=busy||next.complete;b.setAttribute('aria-pressed',String(i+1===next.selected))});
    confirm.disabled=busy||next.complete||!next.scanned_channels.includes(next.selected);
    confirm.textContent=next.complete?'Перехват завершён':next.scanned_channels.includes(next.selected)?'Зафиксировать этот канал':'Ждём осмотра камерой Б';
   }else{
    historyList.replaceChildren();for(const [id,values] of Object.entries(next.readings||{}))historyList.append(e('li','',`Канал ${id}: ${values.join(' · ')}`));
    if(changed){window.PerehvatAudio?.fx('reveal');readings.textContent='Новый канал или контур. Наведите камеру на экран А.';if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);}
   }
   if(completed){window.PerehvatAudio?.fx('victory');stop();notice.textContent='Двойной перехват завершён! Две улики добавлены на доску.';refresh();}
  }
  async function selectChannel(channel){if(busy||dead)return;busy=true;apply(state);try{const next=await post('select',{channel,revision:state.revision});if(!dead){apply(next);notice.textContent='Покажите квадрат напарнику. Спросите, какие параметры он видит.';}}catch(err){if(!dead)notice.textContent=err.message;}finally{busy=false;if(!dead)apply(state);}}
  function paint(q,values){const project=window.PerehvatAR.projector(q);ctx.save();ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle='#16162ae8';ctx.fill();ctx.strokeStyle='#cf9bff';ctx.lineWidth=3;ctx.shadowColor='#b866ff';ctx.shadowBlur=14;ctx.stroke();ctx.shadowBlur=0;
   [`КАНАЛ ${state.selected}`, ...values].forEach((line,i)=>{const p=project(.07,.24+i*.25),end=project(.93,.24+i*.25),len=Math.hypot(end.x-p.x,end.y-p.y);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(end.y-p.y,end.x-p.x));ctx.fillStyle=i?'#eff7ff':'#e5b7ff';ctx.font=`bold ${Math.max(8,Math.min(28,len/Math.max(10,line.length*.6)))}px sans-serif`;ctx.fillText(line,0,0,len);ctx.restore();});ctx.restore();}
  async function camera(){stop();const ticket=serial;start.disabled=true;
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){start.disabled=false;notice.textContent='Для этого задания нужна камера Б и HTTPS. На локальном HTTP оно недоступно; можно вернуться к основной истории.';return;}
   notice.textContent='Разрешите камеру и наведите её на квадрат на экране игрока А.';
   try{const acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});if(dead||ticket!==serial){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;video.srcObject=stream;await video.play();if(dead||ticket!==serial)return;let previous=0;
    const tick=now=>{if(dead||ticket!==serial)return;raf=requestAnimationFrame(tick);if(now-previous<125||video.readyState<2)return;previous=now;
     try{canvas.width=640;canvas.height=Math.round(640*video.videoHeight/video.videoWidth)||400;ctx.drawImage(video,0,0,canvas.width,canvas.height);const im=ctx.getImageData(0,0,canvas.width,canvas.height),qr=window.jsQR(im.data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});
      if(qr?.data!==`PEREHVAT:RELAY:V1:${state.selected}`){notice.textContent=qr?'Это не текущий канал. Наведите камеру на экран А.':'Держите весь квадрат в кадре, без бликов.';return;}
      const values=state.readings?.[String(state.selected)];
      if(values){const l=qr.location;paint([l.topLeftCorner,l.topRightCorner,l.bottomRightCorner,l.bottomLeftCorner],values);readings.textContent=`Канал ${state.selected}: ${values.join(' · ')}`;notice.textContent='Передайте эти параметры игроку А. Целевые настройки знает только он.';}
      else if(!scanning&&Date.now()>=retryAt){scanning=true;const revision=state.revision;post('scan',{marker:qr.data,revision}).then(next=>{if(!dead)apply(next)}).catch(err=>{if(!dead){notice.textContent=err.message;retryAt=Date.now()+1500;poll();}}).finally(()=>{scanning=false});}
     }catch(err){stop();notice.textContent='Ошибка обработки камеры. Попробуйте включить её снова.';}
    };raf=requestAnimationFrame(tick);
   }catch(err){if(dead||ticket!==serial)return;stop();notice.textContent='Камера недоступна. Разрешите доступ в браузере и нажмите «Включить камеру» снова. Для этого эпизода экранной замены нет.';}
  }
  try{const initial=await api(base);if(dead)return;
   if(initial.role==='a'){
    intro.textContent='Вы управляете передатчиком. Покажите квадрат на экране напарнику Б: только его камера проявит параметры. Скажите ему, какой канал нужен, и сравните показания с целью.';
    stage.append(goal,display);const row=e('div','relay-channels');for(let i=1;i<=4;i++){const b=button('Канал '+i,()=>selectChannel(i));choices.push(b);row.append(b)}
    confirm=button('Ждём осмотра камерой Б',async()=>{if(busy)return;busy=true;apply(state);try{const next=await post('confirm',{revision:state.revision});if(!dead){apply(next);notice.textContent=next.complete?'Все контуры собраны. Улики уже на доске.':next.correct?'Контур согласован. У следующего контура новые параметры — потребуется новый осмотр.':'Параметры не подходят. Сравните оба значения с целью и проверьте другой канал.';}}catch(err){if(!dead){notice.textContent=err.message;poll();}}finally{busy=false;if(!dead)apply(state);}});
    controls.append(row,confirm);
   }else{
    intro.textContent='Вы — наблюдатель. Наведите заднюю камеру на квадрат на экране А. Вам видны скрытые параметры, а напарнику — цель. Прочитайте показания вслух. Печатать карточки не требуется.';
    ctx=canvas.getContext('2d',{willReadFrequently:true});stage.append(video,canvas,readings,history);start=button('Включить камеру',camera);controls.append(start,button('Остановить камеру',()=>{stop();notice.textContent='Камера выключена. Для нового осмотра включите её снова.';}));
   }
   apply(initial);if(!initial.complete)notice.textContent=initial.role==='a'?'Начните с любого канала и покажите квадрат игроку Б.':'Включите камеру. В этом эпизоде нет режима без камеры.';
   timer=setInterval(poll,1200);
  }catch(err){notice.textContent=err.message;}
 }
};
