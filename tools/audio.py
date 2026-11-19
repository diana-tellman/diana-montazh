# python3 -I tools/audio.py <source.mov> <t_start> <t_end> <out.wav> [swipe_t ...]
import sys, subprocess, numpy as np, wave
SRC,T0,T1,OUT=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
SWIPES=[float(x) for x in sys.argv[5:]]
SR=44100
raw=subprocess.run(["ffmpeg","-v","error","-ss",str(T0),"-t",str(T1-T0),"-i",SRC,"-vn","-f","f32le","-ac","2","-ar",str(SR),"-"],capture_output=True,check=True).stdout
a=np.frombuffer(raw,np.float32).reshape(-1,2).copy()
def swipe(dur=0.42,peak_db=-21.0):
    # шум, пропущенный через полосу, которая скользит вверх по частоте: «вжух» без щелчков
    n=int(dur*SR); rng=np.random.default_rng(7); x=rng.standard_normal(n)
    out=np.zeros(n); blk=1024; win=np.hanning(blk)
    for s in range(0,n-blk,blk//2):
        p=s/n; fc=350*(3500/350)**(p**0.8)             # центр полосы 350→3500 Гц
        F=np.fft.rfft(x[s:s+blk]*win); fr=np.fft.rfftfreq(blk,1/SR)
        F*=np.exp(-0.5*((np.log(fr+1)-np.log(fc))/0.55)**2)
        out[s:s+blk]+=np.fft.irfft(F)*win
    t=np.linspace(0,1,n); env=np.sin(np.pi*np.clip(t/0.55,0,1)/2)**2*np.exp(-np.clip(t-0.55,0,None)*6.0)
    env*=np.clip((1-t)/0.12,0,1)
    out*=env; out/=np.abs(out).max(); return out*10**(peak_db/20)
for st in SWIPES:
    s=swipe(); i=int((st-T0)*SR)
    L=min(len(s),len(a)-i); a[i:i+L,0]+=s[:L]; a[i:i+L,1]+=s[:L]*0.9
# микро-фейды клипа
f=int(0.10*SR); a[:f]*=np.linspace(0,1,f)[:,None]; g=int(0.20*SR); a[-g:]*=np.linspace(1,0,g)[:,None]
print("peak dBFS",20*np.log10(np.abs(a).max()+1e-9))
a=np.clip(a,-1,1); w=wave.open(OUT,"wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((a*32767).astype(np.int16).tobytes()); w.close()
