# Звук: исходная дорожка без изменений + синтезированные точечные акценты (свои, ничего не взято из референсов).
# python3 -I tools/audio_final.py <source.mov> <out.wav>
import sys, subprocess, numpy as np, wave
SRC,OUT=sys.argv[1],sys.argv[2]; SR=44100
raw=subprocess.run(["ffmpeg","-v","error","-i",SRC,"-vn","-f","f32le","-ac","2","-ar",str(SR),"-"],capture_output=True,check=True).stdout
a=np.frombuffer(raw,np.float32).reshape(-1,2).copy(); print("исходник: %.3f с"%(len(a)/SR))
db=lambda x:10**(x/20)
def tick(peak=-27):      # мягкий «щелчок» появления цитаты
    n=int(0.09*SR); t=np.arange(n)/SR; x=np.sin(2*np.pi*(900-3500*t)*t)*np.exp(-t*60); return x/np.abs(x).max()*db(peak)
def shimmer(peak=-23):   # лёгкое мерцание для «сияющая изнутри»
    n=int(1.1*SR); t=np.arange(n)/SR; x=np.zeros(n); rng=np.random.default_rng(3)
    for f,d in [(2093,.5),(2637,.8),(3136,1.0),(4186,.6),(5274,.4)]:
        x+=d*np.sin(2*np.pi*f*(1+rng.uniform(-.002,.002))*t)*np.exp(-t*(3.5+f/2500))*np.clip(t/0.012,0,1)
    return x/np.abs(x).max()*db(peak)
def swipe(peak=-24):     # свайп: шум, полоса скользит вверх
    n=int(0.42*SR); rng=np.random.default_rng(7); x=rng.standard_normal(n); out=np.zeros(n); blk=1024; win=np.hanning(blk)
    for s in range(0,n-blk,blk//2):
        p=s/n; fc=350*(3500/350)**(p**0.8); F=np.fft.rfft(x[s:s+blk]*win); fr=np.fft.rfftfreq(blk,1/SR)
        F*=np.exp(-0.5*((np.log(fr+1)-np.log(fc))/0.55)**2); out[s:s+blk]+=np.fft.irfft(F)*win
    t=np.linspace(0,1,n); env=np.sin(np.pi*np.clip(t/0.55,0,1)/2)**2*np.exp(-np.clip(t-0.55,0,None)*6.0)*np.clip((1-t)/0.12,0,1)
    out*=env; return out/np.abs(out).max()*db(peak)
def thump(peak=-27):     # короткий низкий удар на «на корню»
    n=int(0.45*SR); t=np.arange(n)/SR; ph=2*np.pi*(46*t+(120-46)*0.06*(1-np.exp(-t/0.06)))
    x=np.sin(ph)*np.exp(-t*9)+0.35*np.sin(2*ph)*np.exp(-t*14); x*=np.clip(t/0.004,0,1); return x/np.abs(x).max()*db(peak)
EV=[(0.86,tick()),(12.10,shimmer()),(30.58,swipe()),(42.95,thump())]
for t0,s in EV:
    i=int(t0*SR); L=min(len(s),len(a)-i); a[i:i+L,0]+=s[:L]; a[i:i+L,1]+=s[:L]
# мягкий ограничитель только выше -0,6 dBFS, чтобы не было клиппинга после подмешивания
th=0.93; m=np.abs(a)>th; a[m]=np.sign(a[m])*(th+(1-th)*np.tanh((np.abs(a[m])-th)/(1-th)))
print("пик после микса: %.2f dBFS"%(20*np.log10(np.abs(a).max())))
w=wave.open(OUT,"wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a,-1,1)*32767).astype(np.int16).tobytes()); w.close()
