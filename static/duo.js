'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = {room:null, case:null, catalog:[], stage:-1, lastPins:'', lastBoard:'', lastGuest:null, lastDone:false, lastVerdict:'', lastTask:'', lastEvents:'', lastAchievements:'[]', embeddedArKey:null, polling:null, busy:false, roomData:null, introShown:false, fxEnabled:true, shop:null, purchaseCheck:false, speaking:null};
  const el = (tag, cls='', txt) => { const n=document.createElement(tag); if(cls)n.className=cls; if(txt!==undefined)n.textContent=txt; return n; };
  const fmt = name => name==='a'?'А':'Б';
  const ART={room_zero:'/static/art/room_zero.webp',scarlet_letter:'/static/art/scarlet_letter.webp',white_route:'/static/art/white_route.webp'};
  const CASE_NAMES={room_zero:'Квартира 0',scarlet_letter:'Алое письмо',white_route:'Белый рейс'};
  const CASE_PRODUCTS=Object.keys(CASE_NAMES);
  let toastTimer,modalReturnFocus;
  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3200);}
  function artFor(id){return ART[id]||ART.room_zero;}
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function vibrate(ms=24){if(state.fxEnabled && navigator.vibrate)try{navigator.vibrate(ms);}catch(_){} }
  function hasReducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
  const textTimers=new WeakMap();
  function typeText(node,text,onComplete=null){
    clearInterval(textTimers.get(node));
    text=String(text||'');
    node.textContent=text;
    node.setAttribute('aria-label',text);
    node.title='Нажмите, чтобы показать текст сразу';
    let finished=false;const finish=()=>{if(finished)return;finished=true;if(typeof onComplete==='function')onComplete();};
    node.onclick=()=>{clearInterval(textTimers.get(node));textTimers.delete(node);node.textContent=text;finish();};
    if(!state.fxEnabled||hasReducedMotion()||!text||text.length>600){finish();return;}
    node.textContent='';
    let index=0;
    const speed=localStorage.getItem('perehvat_text_speed')||'normal';
    if(speed==='instant'){node.textContent=text;finish();return;}
    const step=speed==='fast'?3:1;
    const timer=setInterval(()=>{
      index=Math.min(text.length,index+step);
      node.textContent=text.slice(0,index);
      if(['storyLine','dialogueLine','detailText'].includes(node.id))sound()?.typeTick();
      if(index>=text.length){clearInterval(timer);textTimers.delete(node);finish();}
    },speed==='fast'?12:22);
    textTimers.set(node,timer);
  }
  function speakText(text,button){
    if(!('speechSynthesis' in window)){toast('Синтез речи недоступен в этом браузере.');return;}
    speechSynthesis.cancel();
    const utter=new SpeechSynthesisUtterance(String(text));utter.lang='ru-RU';utter.rate=.91;utter.pitch=.92;
    const voices=speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith('ru'));
    if(voices.length)utter.voice=voices[0];
    button.disabled=true;button.textContent='◉ Звучит…';
    sound()?.duck(true);
    utter.onend=utter.onerror=()=>{button.disabled=false;button.textContent='▶ Озвучить показания';sound()?.duck(false);};
    speechSynthesis.speak(utter);
  }
  function triggerHorror(stage){
    if(!state.fxEnabled||hasReducedMotion()||state.case?.id!=='room_zero'||stage!==3)return;
    const pulse=$('horrorPulse');if(!pulse)return;
    pulse.classList.remove('hidden');vibrate([20,40,40]);playFx('horror');
    setTimeout(()=>pulse.classList.add('hidden'),860);
  }
  function celebrateBurst(){if(hasReducedMotion()||!state.fxEnabled)return;document.body.animate([{filter:'brightness(1)'},{filter:'brightness(1.12)'},{filter:'brightness(1)'}],{duration:420,easing:'ease'});}
  function showBadge(title,text='Новая награда команды'){const host=$('badgeBlast');if(!host)return;const pop=el('div','badge-pop');const icon=el('div','icon','★');const copy=el('div','');copy.append(el('b','',title),el('span','',text));pop.append(icon,copy);host.append(pop);playFx('badge');setTimeout(()=>pop.remove(),3600);}
  function showStageReveal(title,text,kicker='НОВЫЙ ЭТАП'){const wrap=$('stageReveal');if(!wrap)return;$('stageRevealKicker').textContent=kicker;$('stageRevealTitle').textContent=title;$('stageRevealText').textContent=text||'';wrap.classList.remove('hidden');playFx(kicker==='ФИНАЛ'?'victory':'reveal');setTimeout(()=>wrap.classList.add('hidden'),1650);}
  function applyFxPref(on){state.fxEnabled=on;document.body.dataset.fx=on?'on':'off';const btn=$('fxToggle');if(btn){btn.textContent=on?'✦ FX: вкл.':'✦ FX: выкл.';btn.setAttribute('aria-pressed',String(on));}try{localStorage.setItem('perehvat_duo_fx', on?'1':'0')}catch(_){} }
  function toggleFx(){applyFxPref(!state.fxEnabled); if(state.fxEnabled) playFx('tap');}
  function playFx(kind='tap'){if(state.fxEnabled)sound()?.fx(kind);}
  function showCinemaIntro(title,text,kicker='ПРЕДБРИФИНГ'){ const box=$('cinemaIntro'); if(!box) return; $('introKicker').textContent=kicker; $('introTitle').textContent=title; $('introText').textContent=text; box.classList.remove('hidden'); if(state.case?.id==='room_zero') playFx('horror'); else playFx('reveal'); }
  function hideCinemaIntro(){ const box=$('cinemaIntro'); if(box) box.classList.add('hidden'); }
  async function req(url, opts={}){
    const headers={'Accept':'application/json', ...(opts.method && opts.method!=='GET'?{'Content-Type':'application/json'}:{}), ...(opts.headers||{})};
    if(state.room)headers['X-Coop-Token']=state.room.token;
    const response=await fetch(url,{...opts,headers,cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.detail||`Ошибка ${response.status}`);
    return data;
  }
  function openModal(nodes){releaseEmbeddedAR();window.PerehvatAR?.dispose?.();window.RelayAR?.dispose?.();sound()?.mood('evidence');modalReturnFocus=document.activeElement;$('modalBody').replaceChildren(...nodes);const title=$('modalBody').querySelector('h2,h3');if(title)title.id='modalTitle';$('modal').classList.remove('hidden');$('modalClose').focus();}
  function closeModal(){window.PerehvatAR?.dispose?.();window.RelayAR?.dispose?.();$('modal').classList.add('hidden');modalReturnFocus?.focus?.();if(activeScreen==='miniBox' && state.roomData)renderEmbeddedAR(state.roomData);sceneSound(); if('speechSynthesis' in window)try{speechSynthesis.cancel();}catch(_){} }
  function btn(label,klass,fn){const b=el('button',klass,label);b.type='button';b.onclick=fn;return b;}
  function spinner(btnEl,flag){btnEl.disabled=flag;btnEl.style.opacity=flag?'.6':'1';}
  function applyLook(look){document.body.dataset.look=look;$('lookToggle').textContent=look==='cinema'?'◐ Стандартный стиль':'✦ Красочный стиль';try{localStorage.setItem('perehvat_duo_look',look)}catch(_){}}
  function getSaved(code){try{return JSON.parse(localStorage.getItem('perehvat_duo_room_'+code)||'null');}catch(_){return null;}}
  function saveRoom(r){try{localStorage.setItem('perehvat_duo_room_'+r.code,JSON.stringify(r));localStorage.setItem('perehvat_duo_lastroom',r.code);}catch(_){}}
  function eraseHash(){if(location.search.includes('room=')){history.replaceState(null,'','/duo');}}

  const sound = () => window.PerehvatAudio;
  const soundsForScreen = {sceneBox:'scene',locationBox:'scene',witnessBox:'witness',evidenceBox:'evidence',boardBox:'evidence',miniBox:'logic',solvePanel:'danger',activityBox:'evidence'};
  function sceneSound(){
    if(!$('storyOverlay').classList.contains('hidden'))return;
    if(!$('modal').classList.contains('hidden'))return;
    if(state.roomData?.done) sound()?.mood('ending');
    else sound()?.mood(soundsForScreen[activeScreen]||'scene');
  }
  function updateSoundControls(snapshot){
    const toggle=$('ambientToggle');
    if(toggle){toggle.textContent=snapshot.enabled?'♫ Музыка и звук: вкл.':'♫ Музыка и звук: выкл.';toggle.setAttribute('aria-pressed',String(snapshot.enabled));}
    const pill=$('audioPill');
    if(pill){pill.textContent=snapshot.enabled?'♫':'♪̸';pill.setAttribute('aria-label',snapshot.enabled?'Отключить музыкальное сопровождение':'Включить музыкальное сопровождение');pill.title=snapshot.enabled?'Звук включён — нажмите для отключения':'Звук отключён — нажмите для включения';pill.setAttribute('aria-pressed',String(snapshot.enabled));}
    if($('musicVolume')){$('musicVolume').value=String(snapshot.musicVolume);$('musicVolumeValue').textContent=snapshot.musicVolume+'%';}
    if($('effectVolume')){$('effectVolume').value=String(snapshot.effectVolume);$('effectVolumeValue').textContent=snapshot.effectVolume+'%';}
  }
  function toggleAmbience(){sound()?.toggle();if(sound()?.enabled) sound()?.fx('correct');}
  async function boot(){
    initHub();
    applyLook('cinema')
    $('lookToggle').onclick=()=>applyLook(document.body.dataset.look==='cinema'?'classic':'cinema');
    sound()?.onChange(updateSoundControls);
    $('ambientToggle').onclick=toggleAmbience;
    $('audioPill').onclick=toggleAmbience;
    $('musicVolume').oninput=event=>sound()?.setMusicVolume(event.target.value);
    $('effectVolume').oninput=event=>sound()?.setEffectVolume(event.target.value);
    sound()?.preload();
    applyFxPref((()=>{try{return localStorage.getItem('perehvat_duo_fx')!=='0'}catch(_){return true}})());
    $('fxToggle').onclick=toggleFx;
    $('modalClose').onclick=closeModal;$('modalBack').onclick=closeModal;
    $('openJoin').onclick=joinModal;$('bottomJoin').onclick=joinModal;
    $('leaveRoom').onclick=leaveRoom;
    $('copyInvite').onclick=copyInvite;
    $('introStart').onclick=()=>{sound()?.unlock();hideCinemaIntro();};
    document.querySelectorAll('.room-tabs button').forEach(b => b.onclick=()=>showScreen(b.dataset.target));
    document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>showScreen(b.dataset.screen));
    $('addLink').onclick=addLink;
    $('addTheory').onclick=addTheory;
    $('scratchpad').oninput=()=>{if(state.room){try{localStorage.setItem(`duo_note_${state.room.code}_${state.room.role}`,$('scratchpad').value);}catch(_){}}};
    // A browser session is required for server-verified purchases in production.
    await req('/api/session',{method:'POST',body:'{}'});
    if(new URLSearchParams(location.search).get('payment')==='return'){
      try{await req('/api/payment/verify',{method:'POST',body:'{}'});toast('Проверяем оплату и открываем доступ…');}
      catch(e){toast('Не удалось проверить платёж: '+e.message);}
      const url=new URL(location.href);url.searchParams.delete('payment');history.replaceState(null,'',url.pathname+url.search);
    }
    await refreshShop();
    const catalog=await req('/api/duo/cases');state.catalog=catalog.cases;renderCatalog();loadLeaderboard();$('refreshLeaders').onclick=loadLeaderboard;
    document.querySelectorAll('.pricing-section [data-shop]').forEach(buttonEl=>buttonEl.onclick=()=>chooseShop(buttonEl.dataset.shop));
    const params=new URLSearchParams(location.search);const code=(params.get('room')||'').toUpperCase();
    if(code){const saved=getSaved(code);if(saved){state.room=saved;await enterRoom();}else{joinModal(code);}}
    else{const last=(()=>{try{return localStorage.getItem('perehvat_duo_lastroom')}catch(_){return null}})();if(last){const saved=getSaved(last);if(saved)renderResumeBanner(saved);}}
  }
  async function refreshShop(){
    const data=await req('/api/catalog');state.shop=data;
    const demo=!!data.status?.demo;
    $('shopMode').textContent=demo?'ДЕМОРЕЖИМ · БЕЗ СПИСАНИЙ':'ОФИЦИАЛЬНАЯ ОПЛАТА ЮKASSA';
    $('shopHelp').textContent=demo?'Кнопки ниже открывают контент бесплатно для тестирования. Реальных списаний нет.':'Оплата в рублях через ЮKassa. Покупка одного дела открывает его двум детективам в комнате, созданной покупателем.';
    const ent=data.status?.entitlements||[];
    document.querySelectorAll('.pricing-section [data-shop]').forEach(b=>{
      const prod=b.dataset.shop;
      const owned=ent.includes(prod);
      if(prod==='choose_case')return;
      b.textContent=owned?'✓ Куплено':prod==='duo_bundle3'?(demo?'Открыть 3 дела бесплатно':'Купить 3 дела · 259 ₽'):(demo?'Открыть Premium бесплатно':'Купить Premium · 499 ₽');
      b.disabled=owned;
    });
    const gallery=$('premiumGallery');gallery.replaceChildren();
    gallery.classList.toggle('hidden',!ent.includes('duo_season'));
    if(ent.includes('duo_season')){
      gallery.append(el('h3','','Ваш Premium-арткомплект · 3 обоев для телефона'));
      CASE_PRODUCTS.forEach(id=>{
        const card=el('div','premium-download');
        const im=el('img');im.src=artFor(id);im.alt=CASE_NAMES[id];im.loading='lazy';
        const a=el('a','outline-btn','Скачать: '+CASE_NAMES[id]+' ↗');a.href=`/api/duo/premium-art/${id}`;a.download=`PEREHVAT_DUO_${id}.jpg`;
        card.append(im,a);gallery.append(card);
      });
    }
  }
  function chooseShop(product){
    if(product==='choose_case'){
      const content=[el('div','section-kicker','МАГАЗИН РАССЛЕДОВАНИЙ'),el('h2','','Выбери дело за 99 ₽'),el('p','','Одна покупка откроет историю для обоих детективов в комнате, которую создаёт покупатель.')];
      CASE_PRODUCTS.forEach(id=>{const b=btn(CASE_NAMES[id]+' · 99 ₽','outline-btn',()=>openShop('duo_'+id));content.push(b)});
      openModal(content);return;
    }
    openShop(product);
  }
  function openShop(product){
    const titles={duo_bundle3:'3 дела — полный набор',duo_season:'Premium-коллекция + 3 обоев'};
    CASE_PRODUCTS.forEach(id=>titles['duo_'+id]=CASE_NAMES[id]);
    const price=product==='duo_bundle3'?259:product==='duo_season'?499:99;
    const owned=(state.shop?.status?.entitlements||[]).includes(product);
    const nodes=[el('div','section-kicker','МАГАЗИН ПЕРЕХВАТ DUO'),el('h2','',titles[product]||'Выберите дело'),el('p','',`Стоимость: ${price} ₽. Покупка оформляется на владельца комнаты и открывает соответствующие дела обоим детективам.`)];
    if(product==='duo_season')nodes.push(el('p','','В Premium входят 3 расследования и три цифровых коллекционных обоев для телефона. Новые будущие дела в цену не включены.'));
    if(owned){nodes.push(el('p','', 'Доступ уже открыт.'),btn('Вернуться к игре','main-btn',closeModal));openModal(nodes);return;}
    const demo=!!state.shop?.status?.demo;
    const input=el('input','shop-email');input.type='email';input.placeholder='Email для чека';input.autocomplete='email';input.setAttribute('aria-label','Email для чека');
    if(!demo)nodes.push(input);
    const action=btn(demo?'Открыть бесплатно — ДЕМО':`Оплатить ${price} ₽ в ЮKassa`,'main-btn',async()=>{
      action.disabled=true;
      try{
        if(demo){await req('/api/demo-unlock',{method:'POST',body:JSON.stringify({product_id:product})});closeModal();await refreshShop();if(state.room)await sync();toast('Демо-доступ открыт без оплаты!');}
        else{
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim()))throw Error('Введите корректный email для чека');
          const paid=await req('/api/checkout',{method:'POST',body:JSON.stringify({product_id:product,email:input.value.trim()})});
          if(paid.unlocked){closeModal();await refreshShop();await sync();toast('Доступ уже открыт.');}
          else if(paid.url && new URL(paid.url).protocol==='https:')location.assign(paid.url);
          else throw Error('Платёжная ссылка недоступна');
        }
      }catch(e){toast(e.message);action.disabled=false;}
    });
    nodes.push(action,el('p','hint-small',demo?'Тестовый доступ; настоящие платежи выключены.':'Платёж подтверждается на сервере; доступ откроется после ответа ЮKassa.'));
    openModal(nodes);
  }
  function renderResumeBanner(saved){
    const banner=el('div','resume-banner'); banner.style.cssText='margin:12px 0;padding:14px;border:1px solid var(--gold);border-radius:13px;background:#ffffff0e;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
    banner.append(el('span','',`Сохранена комната ${saved.code} — можно продолжить расследование.`),btn('Продолжить','outline-btn',async()=>{state.room=saved;await enterRoom();}));
    $('cases').before(banner);
  }
  function renderCatalog(){
    const grid=$('caseGrid');grid.replaceChildren();
    state.catalog.forEach((c,i)=>{
      const card=el('article','case-card');
      const cover=el('div','case-cover');cover.style.setProperty('--case-accent',c.accent);
      const artwork=el('div','case-artwork');setAtlas(artwork,'locations',CASE_PRODUCTS.indexOf(c.id)*3);artwork.setAttribute('role','img');artwork.setAttribute('aria-label','Иллюстрация: '+c.title);
      cover.append(artwork,el('span','case-number',c.no),el('div','cover-icon',c.icon));
      const body=el('div','case-body');
      body.append(el('div','case-meta',`${c.subtitle} · ${c.duration}`),el('h3','',c.title),el('p','',c.premise));
      const foot=el('div','case-foot');foot.append(el('span','',`ДОСЬЕ ${String(i+1).padStart(2,'0')} / 03`),btn('Начать дело ↗','main-btn',()=>caseModal(c)));
      body.append(foot);card.append(cover,body);grid.append(card);
    });
  }
  function caseModal(c){
    const art=el('div','modal-cover');setAtlas(art,'locations',CASE_PRODUCTS.indexOf(c.id)*3);art.setAttribute('role','img');art.setAttribute('aria-label',c.title);
    const nodes=[art,el('div','section-kicker',`ДОСЬЕ ${c.no}`),el('h2','modal-title',c.title),el('p','',c.premise),el('p','',`Место действия: ${c.location}`),el('p','',`Длительность: ${c.duration}. Два участника, разные улики и общий финал. Первый этап бесплатно.`)];
    const acts=el('div','action-stack');acts.append(btn('Создать комнату детективов','main-btn',async e=>{const b=e.currentTarget;spinner(b,true);try{const room=await req('/api/duo/rooms',{method:'POST',body:JSON.stringify({case_id:c.id})});state.room=room;saveRoom(room);closeModal();await enterRoom();}catch(err){toast(err.message)}finally{spinner(b,false)}}),btn('Ввести код готовой комнаты','outline-btn',()=>joinModal()),btn('Открыть полное дело · 99 ₽','outline-btn',()=>openShop('duo_'+c.id)));nodes.push(acts);openModal(nodes);
  }
  function joinModal(prefill=''){
    const heading=el('h2','', 'Присоединиться к расследованию');
    const description=el('p','', 'Получите восьмисимвольный код у первого детектива. Каждый участник увидит только свои улики.');
    const input=el('input','code-field');input.type='text';input.placeholder='КОД КОМНАТЫ';input.value=prefill;input.maxLength=8;input.autocomplete='off';input.setAttribute('aria-label','Код комнаты');
    const join=btn('Войти как детектив Б','main-btn',async()=>{
      const code=input.value.toUpperCase().replace(/[^A-Z2-9]/g,'');
      if(code.length!==8){toast('Нужно 8 символов кода');return;}
      const saved=getSaved(code);if(saved){state.room=saved;closeModal();await enterRoom();return;}
      spinner(join,true);
      try{const room=await req('/api/duo/join',{method:'POST',body:JSON.stringify({code})});state.room=room;saveRoom(room);closeModal();await enterRoom();}catch(e){toast(e.message)}finally{spinner(join,false)}
    });
    input.onkeydown=e=>{if(e.key==='Enter')join.click()};
    openModal([el('div','section-kicker','ПРИГЛАШЕНИЕ НАПАРНИКА'),heading,description,input,join]);
  }
  let activeScreen='sceneBox';
  function showScreen(id, animate=true){
    const target=$(id);if(!target)return;
    if(activeScreen==='miniBox' && id!=='miniBox')releaseEmbeddedAR();
    activeScreen=id;
    if(id!=='witnessBox' && 'speechSynthesis' in window)speechSynthesis.cancel();
    $('roomSidebar').classList.remove('drawer-open');$('caseInfo').setAttribute('aria-expanded','false');
    document.querySelectorAll('.investigation > section').forEach(s=>{s.hidden=s.id!==id;s.classList.toggle('screen-active',s.id===id)});
    document.querySelectorAll('.room-tabs button').forEach(b=>{const selected=b.dataset.target===id;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
    if(animate && state.fxEnabled && !hasReducedMotion()) target.animate([{opacity:0,transform:'translateY(18px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
    target.scrollTop=0;sceneSound();
    if(id==='miniBox' && state.roomData)renderEmbeddedAR(state.roomData);
    document.querySelector('.room-tabs button.selected')?.scrollIntoView?.({block:'nearest',inline:'center',behavior:hasReducedMotion()?'auto':'smooth'});
  }
  async function enterRoom(){
    window.SocialBoard?.clear();state.lastEvents='';
    if(!state.room)return;
    const caseMeta=state.catalog.find(x=>x.id===state.room.case_id);
    state.case=caseMeta;document.body.dataset.case=caseMeta?.id||'';
    $('roomCaseTitle').textContent=caseMeta?.title||'Расследование';
    $('roomCaseSub').textContent=caseMeta?.subtitle||'Нерюнгри';
    $('roomCodeTop').textContent=state.room.code;
    $('roomCodeBig').textContent=state.room.code;
    $('rolePill').textContent='ДЕТЕКТИВ '+fmt(state.room.role);
    $('rolePill').classList.toggle('role-b',state.room.role==='b');
    $('roleName').textContent=fmt(state.room.role);
    $('roomView').classList.remove('hidden');document.body.style.overflow='hidden';sound()?.mood('scene');
    showScreen('sceneBox',false);
    state.stage=-1;state.lastPins='';state.lastBoard='';state.lastGuest=null;state.lastDone=false;state.lastVerdict='';state.lastTask='';state.lastEvents='';state.roomData=null;state.introShown=false;
    try{$('scratchpad').value=localStorage.getItem(`duo_note_${state.room.code}_${state.room.role}`)||''}catch(_){$('scratchpad').value=''}
    if(state.polling)clearInterval(state.polling);
    await sync(); state.polling=setInterval(sync,1600);
  }
  function leaveRoom(){releaseEmbeddedAR();window.PerehvatAR?.dispose?.();window.RelayAR?.dispose?.();window.SocialBoard?.clear();if(state.polling)clearInterval(state.polling);state.polling=null;$('roomView').classList.add('hidden');document.body.style.overflow='';document.body.dataset.case='';state.room=null;hideStory();sound()?.mood('menu');eraseHash();loadLeaderboard();showHub('cases');}
  async function sync(){
    if(!state.room||state.busy)return;
    state.busy=true;
    try{
      const r=await req(`/api/duo/rooms/${state.room.code}`);state.roomData=r;
      if($('legacyRoomAR'))$('legacyRoomAR').hidden=!(r.story_version>=8 && r.story_version<10 && r.case_id==='room_zero' && r.stage>=1);
      $('roomInvite').classList.toggle('hidden',!r.waiting);
      $('connectionState').textContent=r.waiting?'◎ ОЖИДАНИЕ ВТОРОГО ДЕТЕКТИВА':'● НАПАРНИК НА СВЯЗИ';
      $('connectionState').style.color=r.waiting?'#ffcf8b':'#89e3c1';
      const prevStage=state.stage;
      const stateChanged=r.stage!==state.stage||r.done!==state.lastDone||r.guest_joined!==state.lastGuest;
      const currentVerdict=JSON.stringify(r.my_verdict||null);const verdictChanged=currentVerdict!==state.lastVerdict;
      const taskStr=JSON.stringify([r.stage,r.my_task_done,r.partner_task_done,r.task,r.sync_shared,r.required_ar]);
      if(stateChanged||verdictChanged){state.stage=r.stage;state.lastDone=r.done;state.lastVerdict=currentVerdict;renderStage(r, prevStage);}
      else if(taskStr!==state.lastTask){renderMiniGame(r);renderSolve(r);}
      state.lastTask=taskStr;renderEmbeddedAR(r);renderScore(r);
      const achStr=JSON.stringify((r.stats&&r.stats.achievements)||[]);
      if(state.lastAchievements && state.lastAchievements!==achStr){
        try{const prev=JSON.parse(state.lastAchievements)||[];const cur=JSON.parse(achStr)||[];cur.filter(x=>!prev.includes(x)).forEach(name=>showBadge(name,'Достижение команды разблокировано'));}catch(_){ }
      }
      state.lastAchievements=achStr;
      const eventsStr=JSON.stringify(r.events);if(eventsStr!==state.lastEvents){
        if(state.lastEvents){let previous=[];try{previous=JSON.parse(state.lastEvents)}catch(_){}const known=new Set(previous.map(e=>e.at+'|'+e.role+'|'+e.action+'|'+e.detail));const fresh=(r.events||[]).filter(e=>e.role!==r.role&&['opinion','review','theory'].includes(e.action)&&!known.has(e.at+'|'+e.role+'|'+e.action+'|'+e.detail));if(fresh.length)toast(fresh[fresh.length-1].detail);}
        state.lastEvents=eventsStr;renderActivity(r.events||[]);
      }
      const pinsStr=JSON.stringify(r.pinned);
      if(pinsStr!==state.lastPins){state.lastPins=pinsStr;renderPins(r.pinned);}
      const boardStr=JSON.stringify([r.code,r.pinned,r.links,r.theories,r.opinions,r.positions,r.players]);
      if(boardStr!==state.lastBoard){state.lastBoard=boardStr;renderBoardTools(r);}
      renderPins(r.pinned); 
      if(state.lastGuest===false&&r.guest_joined){toast('Второй детектив подключился!');playFx('badge');showBadge('Команда в сборе','Теперь можно полноценно начать расследование');}
      state.lastGuest=r.guest_joined;
    }catch(e){$('connectionState').textContent='◌ ПРОВЕРКА СВЯЗИ: '+e.message;}
    finally{state.busy=false;}
  }
  function renderStage(r, prevStage=-1){
    $('stageHeading').textContent=r.stage_title;
    const taskLink=document.querySelector('.scene-actions [data-screen="miniBox"]');
    if(taskLink)taskLink.textContent=r.required_ar && !r.required_ar.complete?'03 / Исследовать AR-улику →':'03 / Выполнить задание →';
    if(prevStage!==r.stage)showScreen(r.done||r.kind==='verdict'?'solvePanel':'sceneBox',prevStage!==-1);
    $('roomView').dataset.stage=String(r.stage);
    $('roomCaseSub').textContent=r.kind==='verdict'?'Окончательный вердикт':`Этап ${r.stage+1} из 7 · ${r.stage_title}`;
    setAtlas($('sceneArt'),'locations',CASE_PRODUCTS.indexOf(state.case?.id)*3);
    setAtlas($('detailArt'),'locations',r.scene_art??0);
    $('detailTitle').textContent=r.location||r.stage_title;typeText($('detailText'),r.scene||'');
    $('sceneArt').style.setProperty('--scene-focus', ['50%','40%','60%','45%','55%','50%','60%'][r.stage%7]);
    if(r.stage!==prevStage && !r.purchase_required && !r.done){showStory(r);}
    if(r.stage!==prevStage && prevStage>=0){sound()?.fx('reveal');}
    if(r.done) {sound()?.mood('ending');sound()?.fx('victory');}
    typeText($('stagePrompt'),r.prompt);
    $('locationName').textContent=r.location||'Локация';typeText($('sceneNarrative'),r.scene||'Исследуйте общий сюжет.'); const art=$('sceneArt'); if(art){ art.className='scene-art case-generic'; if(state.case?.id==='room_zero') art.classList.add('case-room-zero'); if(state.case?.id==='scarlet_letter') art.classList.add('case-scarlet-letter'); if(state.case?.id==='white_route') art.classList.add('case-white-route'); }
    
    const witnesses=$('witnessGrid');witnesses.replaceChildren();$('dialoguePanel').classList.add('hidden');
    const person=(r.witnesses||[])[0];
    if(person){
      $('witnessName').textContent=person.name;setAtlas($('witnessPortrait'),'portraits',person.portrait);
      witnesses.append(btn('Начать допрос','main-btn',()=>openInterview(person)));
    }else{$('witnessName').textContent='Все показания собраны';witnesses.append(el('p','hint-small',r.purchase_required?'Откройте дело, чтобы продолжить.':'Сопоставьте показания на общей доске.'));}
    const stepper=$('stepper');stepper.replaceChildren();
    (r.stage_titles||['Улика','Код','Вердикт']).forEach((label,i)=>{const item=el('div','stage-item'+(i<r.stage?' past':i===r.stage?' active':''));item.append(el('span','',i<r.stage?'✓':String(i+1)),el('div','',label));stepper.append(item)});
    const grid=$('evidenceGrid');grid.replaceChildren();
    r.evidence.forEach(item=>{
      const card=el('article','evidence-card');
      const pic=el('div','evidence-photo');setAtlas(pic,'locations',r.scene_art??0);card.append(pic);
      const types={message:'ПЕРЕПИСКА',file:'ДОКУМЕНТ',photo:'ИЗОБРАЖЕНИЕ',audio:'АУДИОЗАПИСЬ',map:'КАРТА'};
      card.append(el('span','evid-kind',types[item.type]||'УЛИКА'),el('h4','',item.title),el('p','',item.body));
      card.append(btn('＋ Добавить в общий протокол','',async()=>{
        try{await req(`/api/duo/rooms/${state.room.code}/pin`,{method:'POST',body:JSON.stringify({evidence_id:item.id})});toast('Улика отправлена в общий протокол');await sync()}catch(e){toast(e.message)}
      }));
      grid.append(card);
    });
    renderMiniGame(r);renderSolve(r);renderEmbeddedAR(r);
  }
  function releaseEmbeddedAR(){
    if(state.embeddedArKey){window.PerehvatAR?.dispose?.();window.RelayAR?.dispose?.();}
    state.embeddedArKey=null;
    const el=$('storyARGate');if(el){el.hidden=true;delete el.dataset.rendered;el.replaceChildren();}
  }
  function renderEmbeddedAR(r){
    const gate=r?.required_ar,root=$('storyARGate');if(!root)return;
    const allowed=!!gate && !r.purchase_required && !r.waiting;
    const key=allowed && activeScreen==='miniBox' && !gate.complete ? r.code+':'+gate.stage+':'+gate.kind : null;
    const viewKey=allowed ? r.code+':'+gate.stage+':'+gate.kind+':'+activeScreen+':'+String(gate.complete) : 'none';
    if(key && state.embeddedArKey===key)return;
    if(!key && root.dataset.rendered===viewKey)return;
    releaseEmbeddedAR();
    root.dataset.rendered=viewKey;
    if(!allowed){return;}
    root.hidden=false;
    const head=el('div','story-ar-heading');
    head.append(el('span','story-ar-label','ОБЯЗАТЕЛЬНАЯ УЛИКА · ГЛАВА '+(gate.stage+1)),
      el('h3','',gate.title),el('p','',gate.description));
    root.append(head);
    if(gate.complete){root.append(el('div','story-ar-done','✓ Улика восстановлена обоими детективами. Теперь продолжите индивидуальные задачи.'));return;}
    if(activeScreen!=='miniBox'){
      root.append(btn('Открыть сканирование','main-btn',()=>showScreen('miniBox')));
      return;
    }
    const host=el('div','story-ar-interactive');root.append(host);
    state.embeddedArKey=key;
    sound()?.mood('ar');
    sound()?.cue('signal');
    const engine=gate.kind==='mutual'?window.PerehvatAR:window.RelayAR;
    if(!engine?.open){host.append(el('p','status-warning','AR-модуль не загрузился. Проверьте соединение и обновите страницу.'));return;}
    engine.open(host,r.code,req,sync).catch(err=>{host.replaceChildren(el('p','status-warning','Ошибка AR: '+err.message));});
  }
  function renderPins(pins){
    if(!state.roomData)return;
    window.SocialBoard?.render($('pinBoard'),state.roomData,req,sync,toast,p=>openModal([el('h2','',p.title||'Версия'),el('p','',p.body||p.text||''),btn('Закрыть лист','outline-btn',closeModal)]));
  }
  function renderSolve(r){
    const panel=$('solvePanel');panel.replaceChildren();
    panel.append(el('div','section-kicker',r.done?'РАССЛЕДОВАНИЕ ЗАКРЫТО':`ЭТАП ${r.stage+1} / ${r.total_stages}`));
    if(r.purchase_required){panel.append(el('h3','','Бесплатная глава завершена'));if(r.id==='room_zero')panel.append(el('p','','Вы нашли сегодняшнюю подпись на линии, которой не должно существовать. Но инженер так и не вышел. Самый страшный вопрос ещё впереди: что произойдёт, если заговорить с голосом в домофоне?'));panel.append(el('p','','Полное расследование стоит 99 ₽ за комнату. Оплачивает детектив А, оба получают доступ.'));if(r.role==='a')panel.append(btn('Открыть дело · 99 ₽','main-btn',()=>openShop(r.purchase_product)));return;}
    if(r.done){const win=el('div','final-success');win.append(el('h2','', 'Дело раскрыто!'),el('p','',r.outcome),el('p','',`Виновник: ${r.solution?.suspect}. Способ: ${r.solution?.method}. Мотив: ${r.solution?.motive}.`));
      if(r.stats){const stats=el('div','final-stats');stats.append(el('div','rank',`РАНГ ${r.stats.tier}`),el('div','',`Баллы: ${r.stats.points}/1000`),el('div','',`Ошибок: ${r.stats.wrong} · подсказок: ${r.stats.hints}`),el('div','',`Повторных вердиктов: ${r.stats.verdict_retries}`));win.append(stats);} panel.append(win,btn('← Вернуться к делам','outline-btn',leaveRoom));return;}
    if(r.waiting){panel.append(el('h3','', 'Нужен второй детектив'),el('p','', 'Пока напарник не присоединится, общее расследование не начнётся. Передайте ему код комнаты.'));return;}
    if(r.kind==='verdict'){
      panel.append(el('h3','', 'Ваш общий вывод'),el('p','', 'Каждый детектив независимо выбирает виновника, способ и мотив. Оба решения должны совпасть и быть подтверждены доказательствами.'));
      if(r.my_verdict){panel.append(el('p','status-warning',`Твой вердикт отправлен. ${r.partner_verdict_sent?'Проверка общего решения…':'Ждём напарника…'}`));return;}
      const form=el('form','verdict-form');
      const makeSelect=(title,values)=>{
        const label=el('label','verdict-label',title);const sel=el('select','verdict-select');sel.required=true;
        const ph=el('option','', '— выбрать —');ph.value='';sel.append(ph);
        values.forEach(v=>{const o=el('option','',v);o.value=v;sel.append(o);});label.append(sel);form.append(label);return sel;
      };
      const suspect=makeSelect('Кто?',r.suspects||[]);
      const method=makeSelect('Каким способом?',r.methods||[]);
      const motive=makeSelect('Почему?',r.motives||[]);
      const send=btn('Подтвердить вердикт ↗','main-btn',()=>{});send.type='submit';form.append(send);
      form.onsubmit=async e=>{e.preventDefault();spinner(send,true);try{
        const result=await req(`/api/duo/rooms/${state.room.code}/verdict`,{method:'POST',body:JSON.stringify({suspect:suspect.value,method:method.value,motive:motive.value})});
        if(result.retry)toast('Версии не совпали или неверны. Проверьте мотив и способ.');
        else if(result.done)toast('Дело раскрыто!');else toast('Твой вердикт принят. Ждём напарника.');
        await sync();
      }catch(e){toast(e.message)}finally{spinner(send,false)}};
      panel.append(form,btn('Получить подсказку после ошибки','outline-btn',requestHint));return;
    }
    panel.append(el('h3','', 'Завершите обе мини-игры'),
      el('p','', 'У каждого детектива своё задание. Следующий этап откроется только после решения обоих. Сравнивайте личные материалы и общий журнал.'));
    if(r.required_ar){
      const gate=r.required_ar;
      panel.append(el('div','story-ar-solve',gate.complete?'✓ Совместная AR-улика подтверждена.':'◈ Сначала восстановите «'+gate.title+'» — это часть текущей главы.'));
      if(!gate.complete)panel.append(btn('Перейти к сканированию →','main-btn',()=>showScreen('miniBox')));
    }
    if(r.my_task_done)panel.append(el('div','status-warning','✓ Твоя мини-игра завершена.'));
    if(r.partner_task_done)panel.append(el('div','status-warning','✓ Напарник завершил свою мини-игру.'));
    panel.append(btn('Перейти к мини-игре','main-btn',()=>showScreen('miniBox')),
      btn('Подсказка (−40 баллов)','outline-btn',requestHint));
  }
  async function requestHint(){
    try{const data=await req(`/api/duo/rooms/${state.room.code}/hint`,{method:'POST',body:'{}'});openModal([el('div','section-kicker','ПОДСКАЗКА'),el('h2','','Информация из досье'),el('p','',data.hint),btn('Продолжить расследование','outline-btn',closeModal)]);}catch(e){toast(e.message)}
  }
  function renderBoardTools(r){
    const source=$('linkSource'),target=$('linkTarget');
    for(const select of [source,target]){
      const value=select.value;select.replaceChildren();
      const placeholder=el('option','', 'Выберите улику');placeholder.value='';select.append(placeholder);
      (r.pinned||[]).forEach(p=>{const o=el('option','',`${p.from.toUpperCase()} · ${p.title}`);o.value=p.id;select.append(o)});
      if([...select.options].some(x=>x.value===value))select.value=value;
    }
    const names=Object.fromEntries((r.pinned||[]).map(p=>[p.id,p.title]));
    const rel={corroborates:'Подтверждают',contradicts:'Противоречат',timeline:'Связаны по времени'};
    const links=$('linkBoard');links.replaceChildren();
    (r.links||[]).forEach(l=>{const row=el('div','board-row');row.append(el('p','',`${names[l.source]||'Улика'} ↔ ${names[l.target]||'Улика'} · ${rel[l.relation]||l.relation}`),btn('Снять нить','quiet-btn',async()=>{try{await req(`/api/duo/rooms/${state.room.code}/link/delete`,{method:'POST',body:JSON.stringify(l)});await sync()}catch(e){toast(e.message)}}));links.append(row)});
    const theories=$('theoryBoard');theories.replaceChildren();
    (r.theories||[]).forEach(t=>{const node=el('div','board-row');node.append(el('strong','',`Детектив ${fmt(t.from)} · ${t.state==='agreed'?'Согласованы оба мнения':t.state==='disputed'?'Есть возражения':'На проверке'}`),el('p','',t.text),el('small','',`Связанных улик: ${(t.evidence_ids||[]).length}. Оценки и нити — на доске выше.`));theories.append(node)});
  }
  async function addLink(){
    const source_id=$('linkSource').value,target_id=$('linkTarget').value,relation=$('linkRelation').value;
    if(!source_id||!target_id||source_id===target_id){toast('Выбери две разные улики.');return;}
    try{await req(`/api/duo/rooms/${state.room.code}/link`,{method:'POST',body:JSON.stringify({source_id,target_id,relation})});toast('Связь добавлена на общую доску.');await sync()}catch(e){toast(e.message)}
  }
  async function addTheory(){
    const text=$('theoryText').value.trim();if(text.length<2){toast('Напиши хотя бы пару слов.');return;}
    try{await req(`/api/duo/rooms/${state.room.code}/theory`,{method:'POST',body:JSON.stringify({text,evidence_ids:[...(window.SocialBoard?.selected||[])]})});window.SocialBoard?.selected.clear();$('theoryText').value='';toast('Версия закреплена для обоих детективов.');await sync()}catch(e){toast(e.message)}
  }
  async function copyInvite(){const link=new URL('/duo',location.href);link.searchParams.set('room',state.room.code);const text=`ПЕРЕХВАТ DUO: подключайся к расследованию! Код ${state.room.code}\n${link.toString()}`;try{await navigator.clipboard.writeText(text);toast('Приглашение скопировано')}catch(_){window.prompt('Скопируй приглашение:',text);}}

  function renderScore(r){
    const st=r.stats||{};
    const pointsEl=$('scorePoints');
    const next=Number(st.points||0); const prev=Number(pointsEl.dataset.points||0);
    pointsEl.dataset.points=String(next);
    pointsEl.innerHTML=''; pointsEl.append(document.createTextNode(String(next)+' '),el('small','','/ 1000'));
    if(prev!==next){pointsEl.animate([{transform:'scale(1)',filter:'brightness(1)'},{transform:'scale(1.06)',filter:'brightness(1.25)'},{transform:'scale(1)',filter:'brightness(1)'}],{duration:360,easing:'ease'});}
    $('scoreRank').textContent=st.tier||'БРОНЗА';
    const badges=$('achievementList');badges.replaceChildren();
    (st.achievements||[]).forEach(name=>badges.append(el('span','',name)));
  }
  function renderActivity(events){
    const feed=$('activityFeed');feed.replaceChildren();
    if(!events.length){feed.append(el('div','hint-small','Журнал пока пуст. Действия появятся после подключения напарника.'));return;}
    [...events].reverse().forEach(ev=>{
      const item=el('div','activity-item');
      const who=ev.role==='a'?'А':ev.role==='b'?'Б':'◎';
      item.append(el('div','activity-mark',who));
      const body=el('div','activity-text',ev.detail);
      const date=(ev.at||'').slice(11,16);
      body.append(el('small','',`${ev.role==='system'?'СИСТЕМА':'ДЕТЕКТИВ '+who} · ${date} UTC`));
      item.append(body);feed.append(item);
    });
  }
  async function loadLeaderboard(){
    const box=$('leaderboardList');box.replaceChildren();
    try{
      const data=await req('/api/duo/leaderboard');
      if(!data.ranking.length){box.append(el('div','board-row','Пока нет завершённых расследований. Первая команда может возглавить рейтинг!'));return;}
      data.ranking.forEach((team,i)=>{
        const row=el('div','leaderboard-row');
        row.append(el('div','leaderboard-number',String(i+1).padStart(2,'0')));
        const detail=el('div','',team.team);
        detail.append(el('small','',`${state.catalog.find(x=>x.id===team.case_id)?.title||'Дело'} · ${team.tier} · ${team.minutes??'—'} мин`));
        row.append(detail,el('div','leaderboard-score',team.points+' / 1000'));box.append(row);
      });
    }catch(e){box.append(el('div','hint-small','Рейтинг недоступен: '+e.message));}
  }
  async function taskMove(kind, data){
    if(!state.room||state.taskBusy)return;state.taskBusy=true;$('miniGame').classList.add('submitting');
    try{
      const result=await req(`/api/duo/rooms/${state.room.code}/task`,{method:'POST',body:JSON.stringify({kind,...data})});
      if(result.correct){sound()?.fx('correct');celebrateBurst();vibrate(18);toast(result.advanced?'Оба завершили! Следующий этап открыт.':result.completed?'Твоя задача завершена!':'Комбинация найдена!');if(result.advanced)showBadge('Этап закрыт','Команда синхронно открыла следующую сцену');}
      else if(result.already_done)toast('Эта задача уже решена.');
      else if(result.already_marked)toast('Эта отметка уже найдена.');
      else {sound()?.fx('error');const message=result.penalty?'Неверная версия: −25 баллов. Попробуйте другой вариант.':'Не получилось три в ряд. Попробуйте ещё!';toast(message);window.TaskLayout?.feedback($('miniGame'),message);}
      await sync();
      if(result.completed&&!result.advanced){showScreen('boardBox');toast('Твоя задача решена. Обсуди улики, пока напарник завершает свою.');}
    }catch(e){toast(e.message);}
    finally{state.taskBusy=false;$('miniGame').classList.remove('submitting');}
  }
  function renderMiniGame(r){
    const box=$('miniGame');box.replaceChildren();
    try {
    const status=$('teamTaskStatus');status.replaceChildren();
    status.append(el('span','player-chip'+(r.my_task_done?' complete':''),`Ты ${r.my_task_done?'✓':'…'}`),
      el('span','player-chip'+(r.partner_task_done?' complete':''),`Напарник ${r.partner_task_done?'✓':'…'}`));
    if(r.purchase_required){box.append(el('div','paywall-room','Первая глава завершена. Для продолжения хозяин комнаты открывает полное дело — один платёж на двоих.'));
      if(r.role==='a')box.append(btn('Открыть полное дело · 99 ₽','main-btn',()=>openShop(r.purchase_product)));
      else box.append(el('p','hint-small','Попросите детектива А открыть полное дело в магазине. После оплаты продолжение появится автоматически.'));return;}
    if(r.required_ar && !r.required_ar.complete){
      $('miniTitle').textContent='◈ '+r.required_ar.title;
      box.append(el('div','story-ar-task-lock','Для следующей загадки нужна общая улика. Выполните сканирование на двух телефонах ниже по экрану. После расшифровки откроется логическая задача этой главы.'));
      return;
    }
    const t=r.task;
    if(!t){$('miniTitle').textContent='Финальная проверка';box.append(el('p','mini-intro','Все игровые этапы выполнены. Обсудите виновника, способ и мотив, затем заполните вердикт ниже.'));return;}
    $('miniTitle').textContent=t.label;
    if(r.waiting){box.append(el('p','mini-help','Дождитесь второго детектива, прежде чем начинать головоломки.'));return;}
    if(t.done){const done=el('div','task-done');done.append(el('strong','','✓ Личное задание завершено'),el('p','',r.partner_task_done?'Оба детектива завершили — новая сцена открывается…':'Ожидайте напарника. Можно пока связать улики на общей доске.'));box.append(done);return;}
    box.append(el('p','mini-intro','Исследуй свои документы и спроси напарника о недостающих деталях. Неверный ответ снижает рейтинг, но не блокирует историю.'));
    if(t.art_index!==undefined&&window.UniqueGames){window.UniqueGames.render(box,t,taskMove);return;}
    if(window.PerehvatGames?.kinds.has(t.kind)){window.PerehvatGames.render(box,t,taskMove);return;}
    if(t.kind==='circuit'){
      box.append(el('div','mini-help','Это один общий замок для двух телефонов. Ты управляешь своей половиной панели, но нужные контакты знает напарник. Правильные нажатия синхронизируются.'));
      const grid=el('div','circuit-grid');
      (t.contacts||[]).forEach(id=>{
        const owner=id[0].toLowerCase(), active=(r.sync_shared?.[owner]||[]).includes(id);
        const available=owner===r.role;
        const b=btn(`${id[0]} · ${id.slice(1)}`,`circuit-switch ${active?'lit':''} ${available?'mine':'peer'}`,()=>taskMove('circuit',{value:id}));
        b.disabled=!available||active;
        grid.append(b);
      });
      box.append(grid,el('div','puzzle-status',`Твой контур: ${(r.sync_shared?.[r.role]||[]).length}/2 · Контур напарника: ${(r.sync_shared?.[r.role==='a'?'b':'a']||[]).length}/2`));
    }else if(t.kind==='code'){

      const field=el('input','code-field');field.type='text';field.inputMode='numeric';field.maxLength=4;field.placeholder='••••';field.setAttribute('aria-label','Код из четырёх цифр');
      const send=btn('Проверить шифр ↗','main-btn',()=>taskMove('code',{value:field.value.trim()}));
      field.addEventListener('keydown',e=>{if(e.key==='Enter')send.click()});
      box.append(field,send);
    }else if(t.kind==='radio'){
      const opts=t.options||[];const mn=Math.min(...opts.map(Number)),mx=Math.max(...opts.map(Number));
      const dial=el('div','radio-dial');
      const out=el('output','','— MHz');
      const wave=el('div','waveform');for(let i=0;i<35;i++){const line=el('span');line.style.setProperty('--h',`${8+Math.round(30*Math.abs(Math.sin(i*.74)*Math.cos(i*.32)))}px`);wave.append(line)}
      const range=el('input');range.type='range';range.min=String(mn);range.max=String(mx);range.step='.1';range.value=String(opts[Math.floor(opts.length/2)]);
      const syncDisplay=()=>{out.textContent=Number(range.value).toFixed(1)+' MHz'};range.oninput=syncDisplay;syncDisplay();
      dial.append(wave,out,range);
      const quick=el('div','task-options');opts.forEach(o=>quick.append(btn(o+' MHz','task-option',()=>{range.value=o;syncDisplay()})));
      box.append(dial,quick,btn('Принять частоту ↗','main-btn',()=>taskMove('radio',{value:Number(range.value).toFixed(1)})));
    }else if(t.kind==='spot'){
      box.append(el('div','mini-help','Осмотри шесть символов. Три из них повреждены. Правильные отметки знает напарник.'));
      const grid=el('div','symbol-grid');
      (t.symbols||[]).forEach(sym=>{
        const b=btn(sym,'symbol-btn'+((t.hits||[]).includes(sym)?' selected':''),()=>taskMove('spot',{value:sym}));
        if((t.hits||[]).includes(sym))b.disabled=true;
        grid.append(b);
      });
      box.append(grid,el('div','puzzle-status',`Найдено: ${(t.hits||[]).length} / 3`));
    }else if(t.kind==='match3'){
      box.append(el('div','mini-help','Нажми одну фишку, затем соседнюю. Если образуется горизонтальная или вертикальная тройка, ход зачтётся.'));
      const board=el('div','puzzle-grid');let first=null;
      (t.board||[]).forEach((sym,idx)=>{
        const b=btn(sym,'gem',async()=>{
          if(first===null){first=idx;b.classList.add('selected');return;}
          const a=first;first=null;board.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));
          if(a===idx)return;
          const adjacent=(Math.abs(a-idx)===5)||(Math.abs(a-idx)===1&&Math.floor(a/5)===Math.floor(idx/5));
          if(!adjacent){toast('Поменять местами можно только соседние фишки.');return;}
          await taskMove('match3',{index:a,target:idx});
        });b.dataset.symbol=sym;b.setAttribute('aria-label','Фишка '+sym);board.append(b);
      });
      box.append(board,el('div','puzzle-status',`Комбинаций найдено: ${t.moves_done||0} / ${t.goal||2}`));
    }else if(t.kind==='timeline'||t.kind==='route'){
      const items=t.events||t.places||[];
      box.append(el('div','mini-help',t.kind==='timeline'?'Собери хронологию: нажимай карточки в нужном порядке.':`Выбери ${t.required_steps||items.length} точки по порядку. Лишние точки пропусти.`));
      const required=t.required_steps||items.length;
      const chosen=[];const order=el('div','task-order','Нажми первую карточку…');const grid=el('div','task-options');
      const renderOrder=()=>{order.textContent=chosen.length?chosen.map(id=>items.find(x=>x[0]===id)?.[1]||id).join(' → '):'Нажми первую карточку…';};
      items.forEach(([id,label])=>{
        const b=btn(label,'task-option',()=>{
          if(chosen.includes(id)||chosen.length>=required)return;
          chosen.push(id);b.classList.add('queued');b.disabled=true;renderOrder();
        });grid.append(b);
      });
      const controls=el('div','task-toolbar');
      controls.append(btn('Сбросить порядок','',()=>{chosen.length=0;grid.querySelectorAll('button').forEach(b=>{b.disabled=false;b.classList.remove('queued')});renderOrder();}),
        btn('Проверить порядок ↗','main-btn',()=>{if(chosen.length!==required){toast(`Выбери ${required} точки по порядку; лишние пропусти.`);return;}taskMove(t.kind,{value:chosen.join(',')});}));
      box.append(grid,order,controls);
    }
    } finally { window.TaskLayout?.mount(box); }
  }

  function setAtlas(node,type,index){
    index=Math.max(0,Number(index)||0);const rows=type==='portraits'?2:3;
    node.style.backgroundImage=`url('/static/art/${type}-v5.webp')`;
    node.style.backgroundSize=`300% ${rows*100}%`;
    node.style.backgroundPosition=`${index%3*50}% ${Math.floor(index/3)*(100/(rows-1))}%`;
  }
  const HUB_TITLES={cases:'Расследования',pricing:'Магазин дел',profilePage:'Профиль',leaderboard:'Рейтинг',settingsPage:'Настройки'};
  function showHub(id){
    document.querySelectorAll('.hub-page').forEach(p=>p.classList.toggle('hidden',p.id!==id));
    $('hubHeader').classList.toggle('hidden',id==='homePage');$('hubTitle').textContent=HUB_TITLES[id]||'';
    const page=$(id);if(page && !hasReducedMotion() && state.fxEnabled)page.animate([{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,easing:'ease-out'});
    sound()?.mood('menu');window.scrollTo(0,0);if(id==='profilePage')renderProfile();if(id==='leaderboard')loadLeaderboard();
  }
  function profileOptions(){return {toast,names:CASE_NAMES,room:state.roomData&&state.room?{...state.room,done:state.roomData.done}:null,onResume:async room=>{state.room=room;saveRoom(room);closeModal();await enterRoom();}};}
  function renderProfile(){window.SocialProfile?.render($('profileResume'),req,profileOptions());}
  function initHub(){
    document.querySelectorAll('[data-hub]').forEach(b=>b.onclick=()=>showHub(b.dataset.hub));
    $('homeJoin').onclick=()=>joinModal();$('catalogJoin').onclick=()=>joinModal();
    $('detectiveName').value=localStorage.getItem('perehvat_detective_name')||'';
    $('saveProfile').onclick=()=>{localStorage.setItem('perehvat_detective_name',$('detectiveName').value.trim());toast('Имя сохранено на устройстве');};
    $('textSpeed').value=localStorage.getItem('perehvat_text_speed')||'normal';
    $('textSpeed').onchange=()=>localStorage.setItem('perehvat_text_speed',$('textSpeed').value);
    $('fontScale').value=localStorage.getItem('perehvat_font_scale')||'normal';document.body.dataset.font=$('fontScale').value;
    $('fontScale').onchange=()=>{document.body.dataset.font=$('fontScale').value;localStorage.setItem('perehvat_font_scale',$('fontScale').value);};
    $('fullscreenBtn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(_){toast('Полноэкранный режим недоступен. Можно добавить игру на главный экран.');}};
    $('caseInfo').onclick=()=>{const open=$('roomSidebar').classList.toggle('drawer-open');$('caseInfo').setAttribute('aria-expanded',String(open));};
    document.querySelectorAll('[data-board]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('[data-board]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});
      document.querySelectorAll('[data-board-panel]').forEach(x=>x.hidden=x.dataset.boardPanel!==b.dataset.board);
    });
    // Existing v8/v9 rooms keep their optional AR entry; new v10 story rooms have NO separate AR menu.
    const legacyAR=btn('◈ AR (архив)','quiet-btn',()=>{
      openModal([el('h2','','Архивные AR-эпизоды'),el('p','','Эта комната использует прежние необязательные AR-задания.'),
        btn('Скрытый план','outline-btn',()=>{const host=el('div');openModal([host]);sound()?.mood('ar');window.PerehvatAR?.open(host,state.room.code,req,sync);}),
        btn('Двойной перехват','outline-btn',()=>{const host=el('div');openModal([host]);sound()?.mood('ar');window.RelayAR?.open(host,state.room.code,req,sync);})]);
    });
    legacyAR.id='legacyRoomAR';legacyAR.hidden=true;$('roomProfile').before(legacyAR);
    $('roomProfile').onclick=()=>{const host=el('div');openModal([host]);window.SocialProfile.render(host,req,profileOptions());};
    $('finishInterview').onclick=()=>{showScreen('evidenceBox');};
    $('storyNext').onclick=advanceStory;$('storySkip').onclick=hideStory;
    document.addEventListener('keydown',e=>{if(e.key==='Tab'){const dialog=!$('modal').classList.contains('hidden')?$('modal'):!$('storyOverlay').classList.contains('hidden')?$('storyOverlay'):null;if(dialog){const focusables=[...dialog.querySelectorAll('button,input,select,textarea,[tabindex=\"0\"]')].filter(x=>!x.disabled);const first=focusables[0],last=focusables[focusables.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}if(e.key==='Escape'){if(!$('storyOverlay').classList.contains('hidden'))hideStory();else closeModal();}if(e.key==='Enter'&&e.target===$('dialogueLine'))e.target.click();});
  }
  let storyLines=[],storyIndex=0,storyKey='',storyCueToken=0;
  const CINEMATIC_BEATS = {
    0:{speaker:'ДОМОФОН · ЛИНИЯ 0',text:'«Не включайте свет». Голос исчезает в белом шуме. Затем кто-то стучит с другой стороны стены: три раза. Пауза. И ещё два.',cue:'knock_five',subtitle:'◉ ПЯТЬ УДАРОВ · 3 / 2'},
    1:{speaker:'ПРЯМОЙ КАНАЛ · ОТВЕТ',text:'— Если слышите нас, постучите дважды. Ответа нет. Проходят семь секунд. Фонограмма вот-вот повторится… И вдруг — звук из пустоты.',cue:'knock_two',subtitle:'◉ ОТВЕТ ПО ЛИНИИ · 2 УДАРА'},
    3:{speaker:'АРХИВ · КАССЕТА 00',text:'Плёнка едва движется. На секунду слышен щелчок запуска — и снова голос, которого нет в официальной расшифровке.',cue:'tape',subtitle:'◉ АРХИВНАЯ ЛЕНТА · ЗАПУСК'},
    4:{speaker:'ПОМЕХИ · 02:14',text:'Сигнал уходит в треск. Сквозь него на мгновение пробивается дыхание. У вас есть только несколько секунд, чтобы понять, откуда он идёт.',cue:'intercom',subtitle:'◉ ПРЕРЫВИСТОЕ СОЕДИНЕНИЕ'},
    6:{speaker:'ТЕХНИЧЕСКИЙ КОРИДОР',text:'За синей дверью — тишина. Металл прогибается под рукой. Замок отвечает тяжёлым скрежетом, а потом вновь становится тихо.',cue:'door',subtitle:'◉ СИНЯЯ ДВЕРЬ · ПОПЫТКА ОТКРЫТЬ'},
  };
  function showStory(r){
    if(!r.intro?.length||!state.room)return;
    storyKey=`perehvat_story_v5_${state.room.code}_${state.room.role}_${r.stage}`;
    if(localStorage.getItem(storyKey))return;
    storyLines=r.stage===0?[{speaker:'БЮРО «ПЕРЕХВАТ»',text:state.case.premise},...r.intro]:[...r.intro];
    // Cinematic Foley applies only to the new literary revision of Room Zero.
    if(r.story_version>=9 && state.case?.id==='room_zero' && CINEMATIC_BEATS[r.stage]){
      storyLines.push(CINEMATIC_BEATS[r.stage]);
    }
    storyIndex=0;setAtlas($('storyBackdrop'),'locations',r.scene_art??0);
    $('storyOverlay').classList.remove('hidden');sound()?.mood([0,1,4,6].includes(r.stage)?'danger':'scene');
    renderStoryLine();$('storyNext').focus();
  }
  function renderStoryLine(){
    const line=storyLines[storyIndex];storyCueToken++;const token=storyCueToken;
    $('storySpeaker').textContent=line.speaker;
    $('storyNext').disabled=false;
    $('storyNext').textContent=storyIndex===storyLines.length-1?'Начать этап →':'Далее →';
    const caption=$('storySoundCue');caption.hidden=!line.cue;caption.textContent=line.subtitle||'';
    typeText($('storyLine'),line.text,()=>{
      if(token!==storyCueToken || !line.cue)return;
      // The next button briefly pauses while the event unfolds. "Пропустить" remains available.
      const audible=sound()?.enabled && sound()?.unlocked && sound()?.effectVolume>0;
      $('storyNext').disabled=!!audible;
      if(!audible)return;
      sound()?.cinematicCue(line.cue).finally(()=>{
        if(token===storyCueToken && !$('storyOverlay').classList.contains('hidden')){
          $('storyNext').disabled=false;$('storyNext').focus({preventScroll:true});
        }
      });
    });
  }
  function advanceStory(){
    if($('storyNext').disabled)return;
    const n=$('storyLine');if(n.textContent!==n.getAttribute('aria-label')){n.click();return;}
    storyIndex++;if(storyIndex>=storyLines.length)hideStory();else renderStoryLine();
  }
  function hideStory(){
    storyCueToken++;sound()?.cancelCue();
    if(storyKey)localStorage.setItem(storyKey,'1');
    $('storyOverlay').classList.add('hidden');clearInterval(textTimers.get($('storyLine')));$('storyNext').disabled=false;
    sceneSound();
  }
  let interview=null,interviewRead=new Set();
  async function openInterview(person){
    try{
      const data=await req(`/api/duo/rooms/${state.room.code}/interrogate`,{method:'POST',body:JSON.stringify({witness_id:person.id})});
      interview=data;interviewRead=new Set();$('witnessGrid').replaceChildren();$('dialoguePanel').classList.remove('hidden');
      $('dialogueSpeaker').textContent=data.name;setAtlas($('witnessPortrait'),'portraits',data.portrait);
      typeText($('dialogueLine'),data.testimony);renderQuestions();
      $('dialogueSpeak').onclick=()=>speakText($('dialogueLine').getAttribute('aria-label')||$('dialogueLine').textContent,$('dialogueSpeak'));
    }catch(e){toast(e.message)}
  }
  function renderQuestions(){
    const box=$('dialogueChoices');box.replaceChildren();
    for(const q of interview.questions||[]){const b=btn((interviewRead.has(q.id)?'✓ ':'')+q.question,'dialogue-choice'+(interviewRead.has(q.id)?' read':''),()=>{
      if('speechSynthesis' in window)speechSynthesis.cancel();typeText($('dialogueLine'),q.answer);interviewRead.add(q.id);renderQuestions();playFx('tap');
    });box.append(b);}
  }

  boot().catch(e=>{toast('Ошибка загрузки: '+e.message)});
  if ('serviceWorker' in navigator && location.protocol==='https:') {
    navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(()=>{});
  }
})();
