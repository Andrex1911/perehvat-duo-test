"""Original PEREHVAT DUO instrumental score; reproducible offline synthesis.
No samples, third-party recordings, copyrighted melodies or network required.
Run with Python 3 + numpy and ffmpeg. Music in these generated assets is original.
"""
from pathlib import Path
import numpy as np
import wave, subprocess, tempfile

ROOT=Path(__file__).resolve().parent
SR=32000
L=32.0
N=int(SR*L)
T=np.arange(N,dtype=np.float32)/SR
FADE=1.3
rng=np.random.default_rng(4076)

def midi(n): return 440*2**((n-69)/12)
def env(n,dur,attack=.06,release=.8):
    tm=np.arange(n)/SR
    a=np.clip(tm/max(attack,.0001),0,1)
    r=np.clip((dur-tm)/max(release,.0001),0,1)
    return np.minimum(a,r)**.85

def synth_pad(freq,dur,character='cold'):
    n=int(dur*SR);tm=np.arange(n,dtype=np.float32)/SR
    detune=np.sin(tm*.18)*.007
    wave=(np.sin(2*np.pi*freq*(tm+detune))*.67+np.sin(2*np.pi*(freq*1.003)*tm)*.31+
          .17*np.sin(2*np.pi*freq*.501*tm)+.085*np.sin(2*np.pi*freq*2.01*tm))
    if character=='warm':wave+=.08*np.sin(2*np.pi*freq*3*tm)
    wave *= env(n,dur,1.35,1.8)*(0.85+0.15*np.sin(2*np.pi*tm*.11))
    return wave

def pluck(freq,dur=1.2,tone='glass'):
    n=int(dur*SR);tm=np.arange(n,dtype=np.float32)/SR
    k=.48 if tone=='soft' else .75
    sig=(np.sin(2*np.pi*freq*tm)+k*np.sin(2*np.pi*freq*2.002*tm)+
         .18*np.sin(2*np.pi*freq*3.009*tm))
    sig*=np.exp(-tm*(2.1 if tone=='soft' else 1.35))*(1-np.exp(-tm*160))
    return sig

def place(target,part,start,gain=1):
    i=int(start*SR); j=min(N,i+len(part))
    if i<0:return
    if i<N:target[i:j]+=part[:j-i]*gain

def make_score(name, chords, bpm, mode,seed):
    ran=np.random.default_rng(seed)
    l=np.zeros(N,dtype=np.float32);r=np.zeros_like(l)
    sec_per_bar=60/bpm*4
    # Eight bars; chords cycle 4/8 bars. Padding with overlapping note tails yields fluid loop.
    for bar in range(8):
        start=bar*sec_per_bar
        notes=chords[bar%len(chords)]
        for ix,n in enumerate(notes):
            # slowly breathing consonant pad; intentionally very quiet under dialogue
            p=synth_pad(midi(n),sec_per_bar+2.9,'warm' if mode in ('menu','ending') else 'cold')
            balance=(-.32+ix*.21)
            place(l,p,start,.04*(1-balance));place(r,p,start,.04*(1+balance))
        root=notes[0]-12
        bass=synth_pad(midi(root),sec_per_bar+1,'cold')
        place(l,bass,start,.046);place(r,bass,start,.046)
        # Three-note motif cycles; silence is intentional for reading and investigation.
        if mode in ('menu','logic','ar'):
            placements=[.3,1.25,2.8] if mode!='ar' else [.25,.9,1.8,2.95]
            for idx,pos in enumerate(placements):
                n=notes[(bar+idx+1)%len(notes)]+(12 if mode=='ar' else 0)
                p=pluck(midi(n),.8 if mode=='ar' else 1.35,'glass')
                gain=.022 if mode=='menu' else .025 if mode=='logic' else .032
                place(l,p,start+pos,gain*(.9 if idx%2 else 1.1));place(r,p,start+pos,gain*(1.1 if idx%2 else .9))
        elif mode in ('scene','witness','evidence','ending','danger'):
            pos=[.22,2.4] if mode!='ending' else [.18,1.7,3.15]
            for idx,offset in enumerate(pos):
                n=notes[(bar+idx+1)%len(notes)]+ (0 if mode in ('danger','witness') else 12)
                p=pluck(midi(n),1.65,'soft')
                g={'scene':.014,'witness':.010,'evidence':.017,'ending':.026,'danger':.012}[mode]
                place(l,p,start+offset,g);place(r,p,start+offset,g*.78)
        # Very low percussive heartbeat/pulse; more active during AR and danger.
        if mode in ('logic','ar','danger','witness'):
            beats=[0,1.8] if mode in ('witness','danger') else [0,1,2,3]
            for k,b in enumerate(beats):
                pulse_len=.25
                ts=np.arange(int(SR*pulse_len))/SR
                pulse=np.sin(2*np.pi*(55+45*np.exp(-ts*22))*ts)*np.exp(-ts*19)
                g={'logic':.015,'ar':.032,'danger':.031,'witness':.008}[mode]
                place(l,pulse,start+b,g);place(r,pulse,start+b,g*.95)
    # Low-level original textured noise via slowly varying filtered noise, never masking dialogue.
    raw=ran.standard_normal(N).astype(np.float32)
    # Cumulative rolling mean is near-sub-audible air movement.
    sm=np.convolve(raw[:N],np.ones(35,dtype=np.float32)/35,mode='same')
    modulation=(.7+.3*np.sin(2*np.pi*T*.076))
    text_gain=.003 if mode in ('scene','witness') else .005
    l += sm*modulation*text_gain; r+=np.roll(sm,142)*modulation*text_gain
    # Gentle stereo reflections, length .21 and .34 seconds
    delay1=int(.21*SR);delay2=int(.34*SR)
    l2=l.copy();r2=r.copy()
    l[delay1:] += r2[:-delay1]*.09;r[delay2:]+=l2[:-delay2]*.08
    # Crossfade into the beginning of the loop to ensure loop has no sharp start/stop;
    # the same 32 second score will repeat indefinitely.
    cross=int(FADE*SR)
    z=np.linspace(0,1,cross,endpoint=False,dtype=np.float32)
    l[:cross] = l[:cross]*z + l[-cross:]*(1-z)
    r[:cross] = r[:cross]*z + r[-cross:]*(1-z)
    m=max(float(np.max(np.abs(l))),float(np.max(np.abs(r))))
    if m>0.4:l*=.4/m;r*=.4/m
    pcm=np.clip(np.column_stack((l,r)),-1,1)
    with tempfile.NamedTemporaryFile(suffix='.wav',delete=False) as tmp:
        tmp_name=tmp.name
    try:
        with wave.open(tmp_name,'wb') as wav:
            wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(SR)
            wav.writeframes((pcm*32767).astype('<i2').tobytes())
        output=ROOT/f'{name}.m4a'
        subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',tmp_name,'-c:a','aac','-b:a','96k','-movflags','+faststart',str(output)],check=True)
        print(name,output.stat().st_size)
    finally:Path(tmp_name).unlink(missing_ok=True)

TRACKS={
    'menu': ([[45,52,57,60],[41,48,53,57],[40,47,52,55],[43,50,55,59]],60,'menu'),
    'scene': ([[38,45,50,53],[34,41,46,50],[36,43,48,53],[33,40,45,48]],60,'scene'),
    'witness': ([[38,45,50,53],[36,43,48,51],[34,41,46,50],[33,40,45,48]],60,'witness'),
    'evidence': ([[40,47,52,55],[36,43,48,52],[35,42,47,50],[33,40,45,48]],60,'evidence'),
    'logic': ([[40,47,52,55],[43,47,50,55],[45,52,57,60],[47,51,54,59]],60,'logic'),
    'ar': ([[42,49,54,57],[38,45,50,54],[37,44,49,52],[40,47,52,56]],60,'ar'),
    'danger': ([[41,48,53,56],[37,44,49,52],[39,46,51,54],[36,43,48,51]],60,'danger'),
    'ending': ([[38,45,50,53],[34,41,46,50],[41,48,53,57],[36,43,48,52]],60,'ending'),
}
for i,(name,(chords,bpm,mode)) in enumerate(TRACKS.items()):make_score(name,chords,bpm,mode,3269+i*23)

# Cinematic Foley built from additive resonances and shaped noise (no downloaded samples).
def foley(name,duration,events):
    count=int(duration*SR);tl=np.arange(count,dtype=np.float32)/SR;out=np.zeros(count,dtype=np.float32)
    for which,start in enumerate(events):
        ran=np.random.default_rng(2203+which+sum(ord(c) for c in name))
        length=min(int(.65*SR),count-int(start*SR))
        if length<=0:continue
        tt=np.arange(length,dtype=np.float32)/SR
        noise=ran.standard_normal(length).astype(np.float32)
        # Wood/steel hit: low hollow thud and bright fleeting transient; decay naturally.
        if name.startswith('knock'):
            hit=(np.sin(2*np.pi*(97+which*3)*tt)*np.exp(-tt*24)*.62+
                np.sin(2*np.pi*248*tt)*np.exp(-tt*14)*.27 +
                noise*np.exp(-tt*95)*.18)
            hit*=.8
        elif name=='intercom':
            hit=(noise*.19+np.sin(2*np.pi*185*tt)*.13)*np.exp(-tt*3.0)
        elif name=='tape':
            hit=(noise*.3+np.sin(2*np.pi*470*tt)*.17)*np.exp(-tt*18)
        elif name=='door':
            hit=(np.sin(2*np.pi*(78-20*tt)*tt)*.62+noise*.1)*np.exp(-tt*5)
        elif name=='signal':
            hit=(np.sin(2*np.pi*330*tt)+.33*np.sin(2*np.pi*660*tt))*np.exp(-tt*2)*.22
        elif name=='breath':
            hit=noise*np.sin(np.pi*np.minimum(tt/.65,1))*.07
        else:hit=noise*np.exp(-tt*6)*.2
        st=int(start*SR);out[st:st+length]+=hit
    peak=max(1.,float(np.max(np.abs(out)))/.68);out=out/peak
    with wave.open(str(ROOT/f'{name}.wav'),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes((out*32767).astype('<i2').tobytes())
    print('SFX',name)
foley('knock_five',3.5,[.55,.90,1.24,2.3,2.65])
foley('knock_two',2.9,[1.06,1.65])
foley('intercom',.95,[.1])
foley('tape',.42,[.02])
foley('door',1.8,[.1,.75])
foley('signal',1.25,[.15,.75])
foley('breath',1.5,[.2])
