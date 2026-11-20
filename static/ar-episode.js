'use strict';
/* PEREHVAT 7.4 — «Скрытый план: двойное проявление».
   Видеокадры и распознавание QR остаются на устройстве. */
window.PerehvatAR={dispose:null,
 async open(host,code,api,refresh){
  this.dispose?.();
  let dead=false,state=null,stream=null,serial=0,raf=0,poller=0,polling=false,scanning=false,mode='marker',lastQuad=null,scanRetry=0;
  const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls||'';if(text!==undefined)node.textContent=text;return node};
  const button=(label,handler,kind='outline-btn')=>{const node=make('button',kind,label);node.type='button';node.onclick=handler;return node};
  const base='/api/duo/rooms/'+encodeURIComponent(code)+'/ar';
  const post=(endpoint,value)=>api(base+'/'+endpoint,{method:'POST',body:JSON.stringify(value)});
  const title=make('h2','ar-title','СКРЫТЫЙ ПЛАН');
  const kicker=make('div','ar-kicker','◈ PEREHVAT · AR DOSSIER / 074');
  const subtitle=make('p','ar-subtitle','Два экрана. Две камеры. Одна зашифрованная тайна.');
  const top=make('div','ar-top');top.append(kicker,title,subtitle);
  const progress=make('div','ar-progress');
  const first=make('div','ar-progress-pill'),second=make('div','ar-progress-pill');progress.append(first,second);
  const instruction=make('p','ar-instruction','Получаем данные расследования…');
  const shell=make('div','ar-shell');const marker=make('section','ar-marker-mode');
  const frame=make('div','ar-marker-frame');
  const cornerA=make('i','ar-corner ar-corner-tl'),cornerB=make('i','ar-corner ar-corner-tr'),cornerC=make('i','ar-corner ar-corner-bl'),cornerD=make('i','ar-corner ar-corner-br');
  const radar=make('div','ar-marker-radar');const markerLabel=make('span','ar-marker-label');
  const markerImage=make('img','ar-marker-image');markerImage.alt='Метка вашего экрана для сканирования напарником';markerImage.loading='eager';
  const markerFooter=make('div','ar-marker-footer','НЕ СОДЕРЖИТ РАЗГАДКИ · СКАНИРУЕТ НАПАРНИК');
  frame.append(radar,cornerA,cornerB,cornerC,cornerD,markerLabel,markerImage,markerFooter);
  marker.append(frame,make('p','ar-marker-help','Покажите эту метку напарнику. Его задняя камера проявит секретный слой.'));
  const cameraStage=make('section','ar-camera-mode');
  const video=make('video','ar-video-source');video.muted=true;video.autoplay=true;video.playsInline=true;video.setAttribute('playsinline','');
  const viewport=make('div','ar-viewport-frame');const canvas=make('canvas','ar-viewport');canvas.width=640;canvas.height=480;canvas.setAttribute('aria-label','Камера с AR-наложением скрытых улик');
  const scanBeam=make('div','ar-beam');const aim=make('div','ar-aim');aim.append(make('i'),make('i'),make('i'),make('i'));
  const hudTop=make('div','ar-hud-top','PEREHVAT / СКАНЕР 02'),hudBottom=make('div','ar-hud-bottom','ПОИСК ВТОРОГО ЭКРАНА');
  const flash=make('div','ar-reveal-flash');
  viewport.append(canvas,scanBeam,aim,hudTop,hudBottom,flash);cameraStage.append(viewport);
  shell.append(marker,cameraStage);
  const status=make('p','ar-notice','Подключение…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const tabs=make('div','ar-controls');
  const show=button('▣ Показать мою метку',()=>{stop();mode='marker';renderMode();status.textContent='Передайте телефон напарнику экраном вперёд. Он должен навести камеру на квадрат.';});
  const scan=button('◎ Сканировать напарника',startCamera,'main-btn');
  const stopButton=button('× Остановить камеру',()=>{stop();mode='marker';renderMode();status.textContent='Камера выключена. Можно снова показать свой экран или продолжить сканирование.';});
  tabs.append(show,scan,stopButton);
  const report=make('section','ar-report');const reportTitle=make('div','ar-report-head');
  const reportEyebrow=make('span','ar-report-eyebrow','ЗАКРЫТО · НЕТ ДОСТУПА'),reportHeading=make('h3','','Секретный слой');reportTitle.append(reportEyebrow,reportHeading);
  const reportText=make('p','ar-report-prompt','Сначала направьте камеру на экран напарника.');
  const reportLines=make('div','ar-secret-grid');report.append(reportTitle,reportText,reportLines);
  const dock=make('section','ar-dock');const team=make('p','ar-team','Синхронизация игроков…');
  const question=make('label','ar-question');const select=make('select');select.setAttribute('aria-label','Ваш вариант разгадки');
  question.append(make('span','','Ваш вывод'),select);
  const answer=button('Проверить свою разгадку',async()=>{
   if(!state?.revealed||state?.solved)return;
   if(!select.value){status.textContent='Выберите вариант разгадки.';return;}
   answer.disabled=true;
   try{const next=await post('answer',{value:select.value});if(dead)return;apply(next);
    status.textContent=next.correct?(next.complete?'◈ Дело восстановлено. Две улики добавлены на общую доску.':'✓ Верно! Теперь дождитесь напарника.'):'✕ Код неверный. Сравните информацию двух скрытых слоёв.';
    if(next.correct){report.classList.add('ar-confirmed');await refresh();}
   }catch(err){if(!dead)status.textContent=err.message;}finally{if(!dead)answer.disabled=!state?.revealed||!!state?.solved;}
  },'main-btn');dock.append(team,question,answer);
  const privacy=make('p','ar-privacy','◉ Камера работает локально. Изображение не записывается, не сохраняется и не передаётся на сервер. Для телефона требуется HTTPS.');
  host.className='ar-episode ar-mutual';host.replaceChildren(top,progress,instruction,shell,tabs,status,report,dock,privacy);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  function stop(){serial++;cancelAnimationFrame(raf);raf=0;stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;scan.disabled=!!state?.complete;}
  function hide(){if(document.hidden&&stream){stop();mode='marker';renderMode();status.textContent='Камера остановлена при сворачивании игры.';}}
  this.dispose=()=>{if(dead)return;dead=true;stop();clearInterval(poller);document.removeEventListener('visibilitychange',hide);};
  document.addEventListener('visibilitychange',hide);
  function renderMode(){
   marker.classList.toggle('ar-hidden',mode!=='marker');cameraStage.classList.toggle('ar-hidden',mode==='marker');
   host.classList.remove('ar-mode-marker','ar-mode-camera','ar-mode-frozen');host.classList.add('ar-mode-'+mode);
   show.setAttribute('aria-pressed',String(mode==='marker'));
   scan.setAttribute('aria-pressed',String(mode==='camera'));stopButton.classList.toggle('ar-hidden',mode!=='camera');
   scan.textContent=mode==='frozen'?'◎ Сканировать снова':'◎ Сканировать напарника';
  }
  function apply(next){
   const previously=state?.revealed||false,finished=!!state?.complete;
   state=next;host.classList.toggle('ar-has-clue',next.revealed);
   markerImage.src=next.marker_image||('/static/ar/card-'+next.role+'.png');
   markerLabel.textContent='ЭКРАН '+next.role.toUpperCase()+' / ДОКУМЕНТ #'+(next.role==='a'?'031':'047');
   first.textContent=(next.revealed?'✓':'01')+' ВАША КАМЕРА';first.classList.toggle('done',next.revealed);
   second.textContent=(next.partner_scanned?'✓':'02')+' КАМЕРА НАПАРНИКА';second.classList.toggle('done',next.partner_scanned);
   instruction.textContent=next.complete?'Два цифровых следа сопоставлены. Скрытый доступ подтверждён.':next.revealed?
     (next.partner_scanned?'Оба слоя открыты! Обсудите находки и выберите свои ответы.':'Ваш слой расшифрован. Покажите свою метку напарнику, чтобы он открыл второй.'):
     'Вы — детектив '+next.role.toUpperCase()+'. Покажите свой экран напарнику, затем наведите камеру на его метку.';
   team.textContent='Вы: '+(next.solved?'✓ верно':next.revealed?'◈ слой открыт':'● не сканировали')+'    /    Напарник: '+(next.partner_solved?'✓ верно':'ожидаем');
   answer.disabled=!next.revealed||next.solved;
   select.disabled=!next.revealed||next.solved;
   if(next.clue){
    report.classList.add('ar-unlocked');reportEyebrow.textContent='◈ РАСШИФРОВАНО · СЛОЙ '+next.role.toUpperCase();
    reportHeading.textContent=next.clue.title;reportText.textContent=next.clue.prompt;
    reportLines.replaceChildren();next.clue.lines.forEach((line,i)=>{
     const item=make('div','ar-secret-item');item.append(make('small','','0'+(i+1)),make('span','',line));reportLines.append(item);
    });
    const prior=select.value;select.replaceChildren();const placeholder=make('option','','Выберите…');placeholder.value='';select.append(placeholder);
    for(const option of next.clue.options){const el=make('option','',option);el.value=option;select.append(el);}
    if(next.clue.options.includes(prior))select.value=prior;
   }
   if(next.solved)report.classList.add('ar-confirmed');
   if(!previously&&next.revealed){report.classList.add('ar-just-revealed');window.PerehvatAudio?.fx('reveal');window.PerehvatAudio?.cue('signal');}
   if(!finished&&next.complete){window.PerehvatAudio?.fx('victory');const finalMode=mode==='marker'?'marker':'frozen';stop();mode=finalMode;status.textContent='◈ ПЛАН ВОССТАНОВЛЕН. Две улики добавлены на общую доску.';refresh();}
   if(next.complete){scan.disabled=true;answer.textContent='✓ Расследование завершено';}
   renderMode();
  }
  async function poll(){if(dead||polling)return;polling=true;try{const next=await api(base);if(!dead)apply(next);}catch(err){if(!dead&&!stream)status.textContent='Связь с сервером прервана. Повторяем подключение.';}finally{polling=false;}}
  async function startCamera(){
   if(dead||state?.complete)return;
   stop();mode='camera';renderMode();const ticket=serial;scan.disabled=true;
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){mode='marker';renderMode();scan.disabled=false;status.textContent='Для сканирования нужен HTTPS и разрешение камеры. HTTP по адресу Wi‑Fi не поддерживается.';return;}
   if(typeof window.jsQR!=='function'){mode='marker';renderMode();scan.disabled=false;status.textContent='Модуль QR не загружен. Перезапустите игру с подключением к сети.';return;}
   status.textContent='Разрешите заднюю камеру и наведите её на QR-квадрат экрана детектива '+(state.role==='a'?'Б':'А')+'.';
   try{
    const acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(dead||ticket!==serial){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;video.srcObject=stream;await video.play();
    if(dead||ticket!==serial){if(stream===acquired)stop();return;}
    scan.disabled=false;let previous=0;
    function tick(now){if(dead||ticket!==serial)return;raf=requestAnimationFrame(tick);
     if(now-previous<110||video.readyState<2)return;previous=now;
     try{
      const width=640,height=Math.round(width*video.videoHeight/video.videoWidth)||480;
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      ctx.drawImage(video,0,0,width,height);
      const frame=ctx.getImageData(0,0,width,height),qr=window.jsQR(frame.data,width,height,{inversionAttempts:'dontInvert'});
      if(qr?.data===state?.target_marker){
       const l=qr.location;lastQuad=[l.topLeftCorner,l.topRightCorner,l.bottomRightCorner,l.bottomLeftCorner];
       if(state.revealed){paint(lastQuad);hudBottom.textContent='✓ СЕКРЕТНЫЙ СЛОЙ ОБНАРУЖЕН';status.textContent='Слой уже открыт. Сверьте документ с показаниями напарника.';}
       else if(!scanning&&Date.now()>scanRetry){
        scanning=true;hudBottom.textContent='ДЕШИФРОВКА СЛОЯ…';
        post('scan',{marker:qr.data}).then(next=>{
         if(dead||ticket!==serial)return;
         apply(next);paint(lastQuad);mode='frozen';
         cameraStage.classList.add('ar-success');hudBottom.textContent='✓ ИНФОРМАЦИЯ ПРОЯВЛЕНА';
         stop();renderMode();status.textContent='◈ Секретный слой найден! Расскажите напарнику о подсказках.';
        }).catch(err=>{if(!dead){status.textContent=err.message;scanRetry=Date.now()+1600;}}).finally(()=>{scanning=false;});
       }
      }else{
       hudBottom.textContent=qr?'ДРУГОЙ МАРКЕР / НУЖЕН '+(state.role==='a'?'Б':'А'):'ПОИСК ВТОРОГО ЭКРАНА';
       if(!state?.revealed)status.textContent=qr?'Это ваша метка или другой документ. Наведите камеру на экран напарника.':'Держите белый QR-квадрат в кадре. Избегайте бликов.';
      }
     }catch(err){stop();mode='marker';renderMode();status.textContent='Ошибка обработки видеокадра. Попробуйте снова.';}
    }
    raf=requestAnimationFrame(tick);
   }catch(err){if(dead||ticket!==serial)return;stop();mode='marker';renderMode();status.textContent='Не удалось включить камеру. Проверьте разрешение браузера и HTTPS.';}
  }
  function paint(quad){if(!state?.clue||!quad)return;
   const project=window.PerehvatAR.projector(quad);ctx.save();ctx.beginPath();quad.forEach((point,i)=>i?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();
   ctx.fillStyle=state.role==='a'?'rgba(3,23,39,.94)':'rgba(29,13,43,.94)';ctx.fill();
   ctx.shadowColor=state.role==='a'?'#56f0ee':'#cf83ff';ctx.shadowBlur=20;ctx.lineWidth=3;ctx.strokeStyle=ctx.shadowColor;ctx.stroke();ctx.shadowBlur=0;
   const lines=state.clue.lines;const header=project(.07,.13),end=project(.93,.13);
   ctx.save();ctx.translate(header.x,header.y);ctx.rotate(Math.atan2(end.y-header.y,end.x-header.x));ctx.font='bold 18px monospace';ctx.fillStyle='#ffdb96';ctx.fillText('PEREHVAT // '+state.role.toUpperCase(),0,0,Math.hypot(end.x-header.x,end.y-header.y));ctx.restore();
   lines.forEach((line,i)=>{
    const y=.26+i*(.65/Math.max(lines.length,1)),from=project(.07,y),to=project(.93,y),width=Math.hypot(to.x-from.x,to.y-from.y);
    ctx.save();ctx.translate(from.x,from.y);ctx.rotate(Math.atan2(to.y-from.y,to.x-from.x));
    ctx.font='bold '+Math.max(9,Math.min(17,width/Math.max(15,line.length*.62)))+'px monospace';ctx.fillStyle=i%2===0?'#a5fff3':'#e6dcff';ctx.fillText(line,0,0,width);ctx.restore();
   });ctx.restore();
  }
  try{
   const initial=await api(base);if(dead)return;apply(initial);mode='marker';renderMode();
   status.textContent=initial.revealed?'Ваш секретный слой открыт. Покажите метку напарнику или проверьте ответ.':'Шаг 1: покажите свою метку. Шаг 2: сканируйте экран напарника.';
   poller=setInterval(poll,1500);
  }catch(err){status.textContent=err.message;scan.disabled=answer.disabled=true;}
 },
 projector(q){const [p0,p1,p2,p3]=q,dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;let g=0,h=0;const den=dx1*dy2-dx2*dy1;if(Math.abs(den)>1e-8){g=(dx3*dy2-dx2*dy3)/den;h=(dx1*dy3-dx3*dy1)/den;}return(u,v)=>{const w=g*u+h*v+1;return{x:((p1.x-p0.x+g*p1.x)*u+(p3.x-p0.x+h*p3.x)*v+p0.x)/w,y:((p1.y-p0.y+g*p1.y)*u+(p3.y-p0.y+h*p3.y)*v+p0.y)/w};};}
};
