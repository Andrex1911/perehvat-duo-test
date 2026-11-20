/* PEREHVAT DUO 7.6 — original adaptive soundtrack, no external assets/services.
 * Music AAC loops and original Foley WAV are authored for this project.
 * Unlocks sound only after a user gesture (mobile browser requirement).
 */
'use strict';
(() => {
  const PREFIX = 'perehvat_audio_76_';
  const TRACKS = new Set(['menu','scene','witness','evidence','logic','ar','danger','ending']);
  const SFX = new Set(['knock_five','knock_two','intercom','tape','door','signal','breath']);
  const get = (key, fallback) => {try {return localStorage.getItem(PREFIX+key) ?? fallback;} catch(_) {return fallback;}};
  const set = (key, value) => {try {localStorage.setItem(PREFIX+key, String(value));} catch(_) {}};
  const clamp = (v, min, max) => Math.max(min,Math.min(max,Number(v)||0));
  const soundPath = (kind,ext) => `/static/audio/${kind}.${ext}`;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  class AudioDirector {
    constructor() {
      this.enabled = get('enabled','1') !== '0';
      this.musicVolume = clamp(get('music','38'),0,100);
      this.effectVolume = clamp(get('effects','65'),0,100);
      this.mode = 'menu';
      this.active = null;
      this.old = null;
      this.ctx = null;
      this.unlocked = false;
      this.transition = 0;
      this.fadeId = 0;
      this.ducked = false;
      this.preloaded = new Map();
      this.playingSfx = new Set();
      this.cueGeneration = 0;
      this.listeners = new Set();
      this.lastTypeTick = 0;
      this.visibilityHandler = () => {
        if(document.hidden) this.suspend();
        else if(this.unlocked && this.enabled) this.resume();
      };
      document.addEventListener('visibilitychange',this.visibilityHandler);
      // iOS and Chrome forbid sound before an explicit interaction. No autoplay workaround.
      const unlock = () => {this.unlock();};
      document.addEventListener('pointerdown',unlock,{capture:true});
      document.addEventListener('touchend',unlock,{capture:true,passive:true});
      document.addEventListener('keydown',unlock,{capture:true});
    }
    onChange(fn) {this.listeners.add(fn);fn(this.snapshot());return ()=>this.listeners.delete(fn);}
    snapshot() {return {enabled:this.enabled,unlocked:this.unlocked,mode:this.mode,musicVolume:this.musicVolume,effectVolume:this.effectVolume};}
    notify() {for(const fn of this.listeners){try{fn(this.snapshot());}catch(_){}}}
    async unlock() {
      if(!this.enabled || this.unlocked) return;
      this.unlocked = true;
      if(!this.ctx){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(AC){try{this.ctx=new AC();}catch(_){}}
      }
      if(this.ctx?.state==='suspended')this.ctx.resume().catch(()=>{});
      if(!document.hidden){
        if(!this.active)this.transitionTo(this.mode,true);
        else this.active.play().catch(()=>{this.unlocked=false;this.notify();});
      }
      this.notify();
    }
    setEnabled(value) {
      this.enabled=!!value;set('enabled',this.enabled?'1':'0');
      if(this.enabled){if(this.unlocked)this.resume();else this.unlock();}
      else {this.cancelCue();this.pauseAll();}
      this.notify();
    }
    toggle(){this.setEnabled(!this.enabled);}
    setMusicVolume(value){this.musicVolume=clamp(value,0,100);set('music',this.musicVolume);this.updateVolume();this.notify();}
    setEffectVolume(value){this.effectVolume=clamp(value,0,100);set('effects',this.effectVolume);this.notify();}
    preload() {
      // Only preload the two essential knocks, not every effect or full track.
      for(const key of ['knock_two','knock_five']){
        if(this.preloaded.has(key))continue;
        const sound = new Audio(soundPath(key,'wav'));sound.preload='auto';
        this.preloaded.set(key,sound);
      }
    }
    desiredVolume(){return .55 * this.musicVolume/100 * (this.ducked?.20:1);}
    updateVolume(){
      if(this.active)this.active.volume = this.desiredVolume();
      // The inactive track is faded out separately.
    }
    makeTrack(mode) {
      const a=new Audio(soundPath(mode,'m4a'));
      a.loop=true;a.preload='auto';a.playsInline=true;a.volume=0;
      return a;
    }
    mood(mode){
      if(!TRACKS.has(mode))mode='scene';
      if(this.mode===mode)return;
      this.mode=mode;
      if(this.enabled && this.unlocked && !document.hidden)this.transitionTo(mode);
      this.notify();
    }
    transitionTo(mode,immediate=false){
      if(!this.unlocked || !this.enabled || document.hidden)return;
      if(this.active?.dataset.audioMode===mode) return;
      cancelAnimationFrame(this.fadeId);
      if(this.old){this.old.pause();this.old.currentTime=0;this.old=null;}
      const previous=this.active;
      const current=this.makeTrack(mode);
      current.dataset.audioMode=mode;
      this.active=current;this.old=previous;
      const wanted=this.desiredVolume();
      current.play().catch(()=>{this.unlocked=false;this.notify();});
      if(immediate || reducedMotion()){
        current.volume=wanted;
        if(previous)previous.pause();
        this.old=null;
      } else {
        const stamp=performance.now();const duration=1300;
        const oldLevel=previous?.volume??0;
        const animate=now=>{
          const f=clamp((now-stamp)/duration,0,1);
          current.volume=clamp(wanted*f,0,1);
          if(previous)previous.volume=clamp(oldLevel*(1-f),0,1);
          if(f>=1){previous?.pause();this.old=null;return;}
          this.fadeId=requestAnimationFrame(animate);
        };
        this.fadeId=requestAnimationFrame(animate);
      }
    }
    pauseAll(){cancelAnimationFrame(this.fadeId);if(this.active){this.active.pause();this.active=null;}if(this.old){this.old.pause();this.old=null;}this.ctx?.suspend?.().catch(()=>{});}
    suspend(){this.active?.pause();this.old?.pause();this.ctx?.suspend?.().catch(()=>{});}
    resume(){
      if(!this.enabled||document.hidden)return;
      this.ctx?.resume?.().catch(()=>{});
      if(this.active?.dataset.audioMode!==this.mode)this.transitionTo(this.mode,true);
      else if(this.active)this.active.play().catch(()=>{});
      else this.transitionTo(this.mode,true);
    }
    duck(value=true){this.ducked=!!value;if(this.active){
      const gain=this.desiredVolume(), a=this.active,from=a.volume,start=performance.now();
      const fade=now=>{if(a!==this.active)return;const f=clamp((now-start)/420,0,1);a.volume=clamp(from+(gain-from)*f,0,1);if(f<1)requestAnimationFrame(fade);};
      requestAnimationFrame(fade);
    }}
    tone(frequency=440,duration=.11,gain=.025,type='triangle',delay=0){
      if(!this.enabled||!this.unlocked||!this.ctx||document.hidden)return;
      try{const ctx=this.ctx;const t=ctx.currentTime+delay;
        const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(frequency,t);
        g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain*this.effectVolume/100,t+.016);
        g.gain.exponentialRampToValueAtTime(.0001,t+duration);
        o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+duration+.03);
      }catch(_){}}
    fx(kind='tap'){
      if(!this.enabled||!this.unlocked||this.effectVolume<=0)return;
      const tones={tap:[[510,.09,.017]],reveal:[[280,.33,.025],[420,.31,.017,.09],[640,.25,.014,.18]],
        badge:[[659,.16,.026],[880,.25,.018,.1]],victory:[[392,.24,.028],[523,.28,.025,.18],[784,.38,.022,.36]],
        horror:[[92,.46,.02],[65,.6,.012,.06]],correct:[[440,.14,.024],[660,.24,.019,.13]],
        error:[[168,.28,.022]],type:[[680,.027,.0035]]};
      for(const [f,d,v,offset=0] of (tones[kind]||tones.tap))this.tone(f,d,v,'triangle',offset);
    }
    typeTick(){
      if(this.effectVolume<12)return;
      const now=performance.now();if(now-this.lastTypeTick<155)return;
      this.lastTypeTick=now;this.fx('type');
    }
    cue(name){
      if(!this.enabled||!this.unlocked||this.effectVolume===0||document.hidden||!SFX.has(name))return Promise.resolve();
      const a=this.preloaded.get(name)?.cloneNode(true)||new Audio(soundPath(name,'wav'));
      a.volume=clamp(.65*this.effectVolume/100,0,1);
      this.playingSfx.add(a);
      return new Promise(resolve=>{
        let ended=false;
        const finish=()=>{if(ended)return;ended=true;clearTimeout(fallback);this.playingSfx.delete(a);a.onended=null;a.onerror=null;resolve();};
        a.onended=finish;a.onerror=finish;
        const fallback=setTimeout(finish,6000);
        a.play().catch(finish);
      });
    }
    cancelCue(){
      this.cueGeneration++;
      for(const a of this.playingSfx){try{a.pause();a.currentTime=0;}catch(_){}}
      this.playingSfx.clear();this.duck(false);
    }
    // The call is asynchronous, never prevents reading if muted/unsupported.
    async cinematicCue(name){
      const generation=++this.cueGeneration;
      if(!this.enabled||!this.unlocked||this.effectVolume===0)return;
      this.duck(true);
      await new Promise(r=>setTimeout(r,reducedMotion()?180:650));
      if(this.cueGeneration!==generation)return;
      await this.cue(name);
      if(this.cueGeneration!==generation)return;
      await new Promise(r=>setTimeout(r,300));
      if(this.cueGeneration===generation)this.duck(false);
    }
  }
  window.PerehvatAudio = new AudioDirector();
})();
