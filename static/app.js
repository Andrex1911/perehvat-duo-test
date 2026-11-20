"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    ready: false,
    catalog: null,
    currentEpisode: null,
    nodes: new Map(),
    unlocked: false,
    currentNode: null,
    progress: {},
    theme: 'color',
    sound: false,
    audio: null,
    seasonFilter: 0,
    storeTab: 'episodes',
    deferredInstall: null,
  };
  const soundKey = 'perehvat_v2_sound';
  const progKey = 'perehvat_v2_progress';

  const E = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  async function api(path, opts = {}) {
    const cfg = { credentials: 'same-origin', cache: 'no-store', ...opts };
    if (cfg.method === 'POST') {
      cfg.headers = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
      if (!cfg.body) cfg.body = '{}';
    }
    const res = await fetch(path, cfg);
    const data = await res.json();
    if (!res.ok) throw Error(data.detail || 'Ошибка запроса');
    return data;
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  const director = () => window.PerehvatAudio;
  function sound(type) {
    const map = {success:'correct',bad:'error',open:'reveal'};
    director()?.fx(map[type]||'tap');
  }
  function setSoundControl(){
    const enabled = director()?.enabled ?? false;
    state.sound = enabled;
    $('soundState').textContent = enabled ? 'ON' : 'OFF';
  }
  function saveProgress() {
    try { localStorage.setItem(progKey, JSON.stringify(state.progress)); } catch (_) {}
  }
  function loadProgress() {
    try { state.progress = JSON.parse(localStorage.getItem(progKey) || '{}') || {}; } catch (_) { state.progress = {}; }
  }
  function setProgress(epId, nodeId) { state.progress[epId] = nodeId; saveProgress(); }
  function getProgress(epId, fallback) { return state.progress[epId] || fallback; }

  function applyTheme(theme) {
    state.theme = theme;
    document.body.dataset.theme = theme;
    $('themeToggle').textContent = theme === 'color' ? 'Вернуться к стандартному дизайну' : 'Включить красочный дизайн';
  }

  async function init() {
    loadProgress();
    setSoundControl();director()?.onChange(setSoundControl);director()?.mood('menu');
    const session = await api('/api/session', { method: 'POST' });
    applyTheme(session.status.theme || 'color');
    await refreshCatalog();
    wire();
    state.ready = true;
    if(new URL(location.href).searchParams.get('payment')==='return'){
      try{
        const result=await api('/api/payment/verify',{method:'POST'});
        await refreshCatalog();
        toast(result.checked ? 'Оплата подтверждена. Доступ открыт!' : 'Проверка оплаты выполнена. Если доступ ещё закрыт, повтори проверку позже.');
      }catch(e){toast(e.message);}
      history.replaceState(null,'','/');
    }
  }

  async function refreshCatalog() {
    state.catalog = await api('/api/catalog');
    renderCatalog();
    renderStore();
  }

  const posters = ['📡','☎️','🚪','👁️','🧬','⏱️','🕰️','✈️','🔇','❄️','🪞','🪐'];

  function episodeProgress(ep) {
    const prog = ep.progress || (state.progress[ep.id] ? {node_id:state.progress[ep.id],completed:false}:null);
    if (!prog || !prog.node_id) return {text:'Не начато',pct:0};
    if (prog.completed) return {text:'Пройдено • можно переиграть',pct:100};
    const i = prog.node_id.startsWith('f') ? Number(prog.node_id.slice(1)) : prog.node_id === 'gate' ? 2 : Number(prog.node_id.slice(1))+2;
    const pct = Math.max(6, Math.min(92, Math.round(i / Math.max(1,ep.scene_count-2)*100)));
    return {text: `Прогресс: ${pct}%`,pct};
  }

  function renderCatalog() {
    const grid = $('episodesGrid');
    grid.replaceChildren();
    const filtered = state.catalog.episodes.filter(ep => state.seasonFilter===0 || ep.season===state.seasonFilter);
    filtered.forEach((ep,idx) => {
      const card = E('article', 'episode-card card');
      card.style.setProperty('--card-accent', ep.accent || '#7c5cff');
      const poster = E('div','episode-poster');
      poster.append(E('div','poster-index',ep.id.toUpperCase().replace('EP','СИГНАЛ #')),E('div','poster-glyph',posters[Number(ep.id.slice(2))-1] || '◉'));
      const top = E('div', 'episode-top');
      const left = E('div');
      left.append(E('div', 'episode-code', `СЕЗОН ${String(ep.season).padStart(2,'0')} • ${ep.subtitle}`), E('div', 'episode-title', ep.title));
      top.append(left, E('div', 'chip' + (ep.unlocked ? ' green' : ''), ep.unlocked ? 'Открыт' : 'Глава 1 бесплатно'));
      const hook = E('div', 'episode-hook', ep.hook);
      const progress = episodeProgress(ep);
      const indicator = E('div');
      indicator.append(E('div','progress-chip',progress.text));
      const line = E('div','progress-line');
      const fill = E('div','progress-fill'); fill.style.width = progress.pct+'%'; line.append(fill);
      indicator.append(line);
      const actions = E('div', 'episode-actions');
      const freeBtn = E('button', 'ghost-btn', progress.pct ? 'Продолжить' : 'Играть бесплатно');
      freeBtn.onclick = () => startEpisode(ep.id, false);
      const fullBtn = E('button', ep.unlocked ? 'secondary-btn' : 'primary-btn', ep.unlocked ? 'Открытая история ↗' : `Полная история • ${ep.price_rub} ₽`);
      fullBtn.onclick = () => ep.unlocked ? startEpisode(ep.id, true) : openEpisodeDrawer(ep.id);
      actions.append(freeBtn, fullBtn);
      card.append(poster,top,hook,indicator,actions);
      grid.append(card);
    });
    const bundleGrid = $('bundleGrid');
    bundleGrid.replaceChildren();
    [...state.catalog.bundles, ...state.catalog.seasons].forEach(bundle => {
      const card = E('article','bundle-card card');
      const title = bundle.episode_ids.length===6 ? 'ПОЛНЫЙ СЕЗОН' : 'ПАКЕТ ИСТОРИЙ';
      card.append(E('div','small-label',title),E('h3','',bundle.title),E('p','',bundle.episode_ids.length===6?'Все шесть историй выбранного сезона по фиксированной цене.':'Три полноценные истории выгоднее по отдельности.'));
      const list = E('div','bundle-list');
      bundle.episode_ids.forEach(id => {const ep=state.catalog.episodes.find(x=>x.id===id);list.append(E('div','chip',ep.title));});
      const actions=E('div','episode-actions');
      const info=E('button','ghost-btn','Что входит'); info.onclick=()=>openBundleDrawer(bundle.id);
      const buy=E('button',bundle.owned?'secondary-btn':'primary-btn',bundle.owned?'Доступ открыт':`Открыть за ${bundle.price_rub} ₽`);
      buy.onclick=()=>bundle.owned?toast('Пакет уже открыт.'):unlockProduct(bundle.id,bundle.price_rub);
      actions.append(info,buy);card.append(list,actions);bundleGrid.append(card);
    });
  }

  function renderStore() {
    if (!state.catalog) return;
    const products=$('storeProducts');
    products.replaceChildren();
    const tab=state.storeTab;
    const items=tab==='episodes'?state.catalog.episodes:tab==='bundles'?state.catalog.bundles:state.catalog.seasons;
    items.forEach(item=>{
      const ep=tab==='episodes';
      const owned=Boolean(item.unlocked || item.owned);
      const title=ep?item.title:item.title;
      const price=ep?item.price_rub:item.price_rub;
      const card=E('div','store-product');
      card.style.borderColor=ep?(item.accent+'44'):'var(--line)';
      card.append(E('div','small-label',ep?item.subtitle:(item.episode_ids.length===3?'3 истории':'6 историй')),E('b','',title));
      if(!ep) card.append(E('small','',item.episode_ids.map(id=>state.catalog.episodes.find(x=>x.id===id).title).join(' • ')));
      else card.append(E('small','',item.hook));
      card.append(E('div','store-price',owned?'✓ Открыто':`${price} ₽`));
      const action=E('button','primary-btn',owned?'Играть':'Открыть доступ');
      action.onclick=()=>{
        if(owned && ep){closeStore();startEpisode(item.id,true);return;}
        if(owned){toast('Пакет уже открыт.');return;}
        unlockProduct(item.id,price);
      };
      card.append(action);
      products.append(card);
    });
  }

  function openStore(tab='episodes') {
    state.storeTab=tab;
    const tabs=document.querySelectorAll('[data-store-tab]');
    tabs.forEach(el=>el.classList.toggle('active',el.dataset.storeTab===tab));
    renderStore();
    $('store').classList.remove('hidden');
    document.body.style.overflow='hidden';
  }
  function closeStore() { $('store').classList.add('hidden');document.body.style.overflow=''; }

  function openDrawer(htmlNodes) {
    closeStore();
    const c = $('drawerContent'); c.replaceChildren(...htmlNodes);
    $('drawer').classList.remove('hidden');
  }
  function closeDrawer() { $('drawer').classList.add('hidden'); }

  function openEpisodeDrawer(epId) {
    const ep = state.catalog.episodes.find(x => x.id === epId);
    const nodes = [];
    nodes.push(E('div', 'small-label', ep.subtitle.toUpperCase()));
    nodes.push(E('h3', '', ep.title));
    nodes.push(E('p', '', ep.hook));
    const price = E('div', 'price-line');
    price.append(E('span', '', 'Полная история'), E('b', '', `${ep.price_rub} ₽`));
    const free = E('div', 'price-line');
    free.append(E('span', '', 'Первая глава'), E('b', '', 'Бесплатно'));
    const actions = E('div', 'episode-actions');
    const play = E('button', 'ghost-btn', 'Сначала пройти бесплатную главу');
    play.onclick = () => { closeDrawer(); startEpisode(epId, false); };
    const buy = E('button', 'unlock-btn', `Открыть эпизод за ${ep.price_rub} ₽`);
    buy.onclick = () => unlockProduct(epId, ep.price_rub, true);
    actions.append(play, buy);
    nodes.push(price, free, actions);
    openDrawer(nodes);
  }

  function openBundleDrawer(bundleId) {
    const bundle = [...state.catalog.bundles, ...state.catalog.seasons].find(x => x.id === bundleId);
    const nodes = [E('div', 'small-label', 'МАГАЗИН ИСТОРИЙ'), E('h3', '', bundle.title), E('p', '', 'Доступ к полным историям. Можно запускать в любом порядке.')];
    bundle.episode_ids.forEach(id => {
      const ep = state.catalog.episodes.find(x => x.id === id);
      nodes.push(E('div', 'price-line'));
      nodes[nodes.length - 1].append(E('span', '', ep.title), E('span', '', ep.subtitle));
    });
    const buy = E('button', 'unlock-btn', `Открыть пакет за ${bundle.price_rub} ₽`);
    buy.onclick = () => unlockProduct(bundle.id, bundle.price_rub, true);
    nodes.push(buy);
    openDrawer(nodes);
  }

  async function unlockProduct(productId, price, close=false) {
    try {
      if (state.catalog.status.demo) {
        await api('/api/demo-unlock', {method:'POST',body:JSON.stringify({product_id:productId})});
        toast('Демо-доступ открыт бесплатно!');
        if(close) closeDrawer();
        await refreshCatalog();
        if(state.currentEpisode && $('game') && !$('game').classList.contains('hidden')) {
          const data=await api('/api/story/'+state.currentEpisode.id);
          state.nodes=new Map(data.nodes.map(x=>[x.id,x]));state.unlocked=data.unlocked;
          if(state.unlocked && state.currentNode==='gate')showNode(state.currentEpisode.paid_start);
        }
        return;
      }
      const nodes=[E('div','small-label','ОПЛАТА ЦИФРОВОГО ДОСТУПА'),E('h3','','Оплата '+price+' ₽'),E('p','','Для чека укажи email. Данные карты вводятся только на защищённом сайте ЮKassa.')];
      const email=E('input','code-input');email.type='email';email.placeholder='Email для чека';email.autocomplete='email';email.style.width='100%';
      const buy=E('button','unlock-btn','Перейти к оплате');buy.style.width='100%';
      buy.onclick=async()=>{
        buy.disabled=true;
        try {
          const result=await api('/api/checkout',{method:'POST',body:JSON.stringify({product_id:productId,email:email.value.trim()})});
          if(result.unlocked){closeDrawer();await refreshCatalog();toast('Доступ уже открыт.');return;}
          if(!result.url)throw Error('Не удалось получить ссылку оплаты');
          window.location.href=result.url;
        }catch(e){toast(e.message);buy.disabled=false;}
      };
      nodes.push(email,buy);openDrawer(nodes);
    }catch(e){toast(e.message);}
  }

  async function startEpisode(epId, forceFull = false) {
    const data = await api(`/api/story/${epId}`);
    state.currentEpisode = data.episode;
    state.nodes = new Map(data.nodes.map(x => [x.id, x]));
    state.unlocked = Boolean(data.unlocked);
    $('gameEpisodeTitle').textContent = state.currentEpisode.title;
    $('game').classList.remove('hidden');
    let start = state.currentEpisode.free_start;
    const serverNode=data.progress?.node_id;
    const savedNode=serverNode || getProgress(epId,start);
    if(forceFull && state.unlocked) start=savedNode || state.currentEpisode.paid_start;
    else start=savedNode;
    if (!state.nodes.has(start)) start = state.currentEpisode.free_start;
    director()?.unlock();showNode(start);
  }

  function closeGame() { $('game').classList.add('hidden');director()?.mood('menu'); }

  function sceneOrder(nodeId) {
    const ids = Array.from(state.nodes.keys());
    return ids.indexOf(nodeId) + 1;
  }

  function showNode(nodeId) {
    if (!state.nodes.has(nodeId)) nodeId = state.currentEpisode.free_start;
    state.currentNode = nodeId;
    setProgress(state.currentEpisode.id, nodeId);
    api('/api/progress/'+state.currentEpisode.id,{method:'POST',body:JSON.stringify({node_id:nodeId})})
      .then(()=>{
        const ep=state.catalog.episodes.find(x=>x.id===state.currentEpisode.id);
        if(ep){ep.progress={node_id:nodeId,completed:state.nodes.get(nodeId)?.kind==='ending'};}
      }).catch(()=>{});
    const node = state.nodes.get(nodeId);
    director()?.mood(node.kind==='ending'?'ending':(['code','frequency'].includes(node.kind)?'logic':node.kind==='paywall'?'menu':'scene'));
    $('gameChapter').textContent = node.chapter;
    $('gameTag').textContent = node.tag;
    $('gameSceneCount').textContent = `${String(sceneOrder(nodeId)).padStart(2, '0')}/${String(state.nodes.size).padStart(2, '0')}`;
    $('gameBar').style.width = `${Math.round(sceneOrder(nodeId) / state.nodes.size * 100)}%`;
    const stage = $('gameStage');
    stage.replaceChildren();
    const card = E('div', 'scene-card');
    card.append(E('h2', 'scene-title', node.title), E('div', 'scene-sub', state.currentEpisode.title));
    const messages = E('div', 'messages');
    node.lines.forEach(line => {
      const m = E('div', 'message');
      m.append(E('div', 'msg-who', line.who), E('div', 'msg-text', line.text));
      messages.append(m);
    });
    card.append(messages);
    const controls = E('div', 'controls');
    renderControls(node, controls);
    card.append(controls);
    stage.append(card);
    stage.scrollTo({ top: 0, behavior: 'smooth' });
    sound('open');
  }

  function actionBtn(text, cls, handler) {
    const b = E('button', `action-btn ${cls || ''}`.trim(), text); b.type = 'button'; b.onclick = handler; return b;
  }

  function renderControls(node, box) {
    if (node.kind === 'dialog') {
      box.append(actionBtn('Продолжить', 'primary', () => showNode(node.next)));
      return;
    }
    if (node.kind === 'choice') {
      node.options.forEach(opt => box.append(actionBtn(opt.label, 'ghost', () => showNode(opt.next))));
      if (node.id !== state.currentEpisode.free_start) box.append(actionBtn('Назад к каталогу', '', closeGame));
      return;
    }
    if (node.kind === 'code') {
      const row = E('div', 'input-line');
      const input = E('input', 'code-input'); input.placeholder = 'Введите код'; input.maxLength = 10;
      const ok = actionBtn('Подтвердить код', 'primary', () => {
        if (input.value.trim() === String(node.code)) { sound('success'); toast('Код принят.'); showNode(node.success_next); }
        else { sound('bad'); toast('Код неверный.'); }
      });
      row.append(input, ok);
      box.append(row, E('div', 'hint', 'Подсказка доступна в этой сцене.'), actionBtn('Показать подсказку', 'ghost', () => toast(node.hint || 'Подсказка недоступна.')));
      return;
    }
    if (node.kind === 'frequency') {
      const inline = E('div', 'action-inline');
      node.choices.forEach(choice => inline.append(actionBtn(`${choice} MHz`, 'ghost', () => {
        if (String(choice) === String(node.correct)) { sound('success'); toast('Частота совпала.'); showNode(node.success_next); }
        else { sound('bad'); toast('Помехи. Это не тот канал.'); }
      })));
      box.append(inline, actionBtn('Подсказка', '', () => toast(node.hint || 'Смотри внимательнее на текст.')));
      return;
    }
    if (node.kind === 'paywall') {
      box.append(E('div', 'hint', 'Бесплатная глава закончилась. Можно продолжить именно этот эпизод или открыть пакет.'));
      const row = E('div', 'action-inline');
      row.append(
        actionBtn(`Открыть эпизод за ${state.catalog.prices.episode} ₽`, 'primary', () => unlockProduct(state.currentEpisode.id, state.catalog.prices.episode)),
        actionBtn('Пакет из 3 за 259 ₽', 'secondary', () => unlockProduct(state.currentEpisode.bundle, state.catalog.prices.bundle3)),
        actionBtn('6 историй сезона за 499 ₽', 'ghost', () => unlockProduct(state.currentEpisode.season===2?'season2':'all6', state.catalog.prices.all6)),
      );
      box.append(row, actionBtn('Вернуться к каталогу', '', closeGame));
      return;
    }
    if (node.kind === 'ending') {
      box.append(actionBtn('Сыграть эпизод заново', 'primary', () => showNode(state.currentEpisode.free_start)), actionBtn('Вернуться к каталогу', '', closeGame));
    }
  }

  function wire() {
    $('themeToggle').addEventListener('click', async () => {
      const next = state.theme === 'color' ? 'classic' : 'color';
      applyTheme(next);
      try { await api('/api/theme', { method: 'POST', body: JSON.stringify({ theme: next }) }); } catch (_) {}
    });
    $('soundToggle').addEventListener('click', () => {
      director()?.toggle();setSoundControl();
      toast(state.sound ? 'Музыкальное сопровождение включено.' : 'Музыка и звуки выключены.');
    });
    $('drawerClose').onclick = closeDrawer;
    $('drawerScrim').onclick = closeDrawer;
    $('gameClose').onclick=()=>{closeGame();refreshCatalog();};
    $('storeOpen').onclick=()=>openStore();
    $('storeClose').onclick=closeStore;
    $('storeScrim').onclick=closeStore;
    document.querySelectorAll('[data-store-tab]').forEach(el=>el.onclick=()=>openStore(el.dataset.storeTab));
    document.querySelectorAll('[data-season]').forEach(el=>el.onclick=()=>{
      state.seasonFilter=Number(el.dataset.season);
      document.querySelectorAll('[data-season]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.season)===state.seasonFilter));
      renderCatalog();
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeStore();closeDrawer();}});
    $('installButton').onclick=async()=>{
      if(state.deferredInstall){
        state.deferredInstall.prompt();
        try{await state.deferredInstall.userChoice;}catch(_){}
        state.deferredInstall=null;
      }else{toast('Открой HTTPS-сайт в Chrome, затем выбери «Установить приложение» в меню браузера.');}
    };
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredInstall=e;$('installButton').hidden=false;});
    window.addEventListener('appinstalled',()=>{$('installButton').hidden=true;state.deferredInstall=null;});
    if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1')){
      navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
    }
    if(matchMedia('(display-mode: standalone)').matches){$('installButton').hidden=true;}

  }

  init().catch(err => {
    const box=document.createElement('main');box.className='wrap';box.style.padding='32px';
    box.append(E('h1','','Ошибка запуска'),E('p','',String(err.message||err)));
    document.body.replaceChildren(box);
  });
})();
