# Рендер монтажа. python3 -I tools/render.py <source.mov> <t_start> <t_end> <out.mp4>
import sys, subprocess, math, os, json, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from subs import SUBS
SRC, T0, T1, OUT = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
W,H,FPS = 1080,1920,30
IVORY=(246,239,226); GOLD=(236,200,124); DARK=np.array([10,8,7],np.float32)
FD="/usr/share/fonts/opentype/inter/"
def inter(w,s): return ImageFont.truetype(FD+f"InterDisplay-{w}.otf",s)
CUT_WIDE=(9.2,24.1)
FEED=dict(t0=29.62, t1=31.34, swipe=30.60, swipe_dur=0.42, xfade=0.10)
def ease_out(x): x=min(max(x,0),1); return 1-(1-x)**3
def ease_out5(x): x=min(max(x,0),1); return 1-(1-x)**5
def ease_in(x): x=min(max(x,0),1); return x**2
def clamp(x): return min(max(x,0.0),1.0)

# ---------- спрайты текста ----------
def sprite(lines, font, fill=IVORY, lh=None, pad=40, spans=None):
    lh=lh or int(font.size*1.24); d0=ImageDraw.Draw(Image.new("RGB",(4,4)))
    ws=[d0.textlength(l,font=font) for l in lines]; w=int(max(ws))+2*pad; h=lh*len(lines)+2*pad
    lay=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(lay)
    for i,l in enumerate(lines): d.text(((w-ws[i])/2,pad+i*lh),l,font=font,fill=fill+(255,))
    sh=Image.new("RGBA",(w,h),(0,0,0,0)); ds=ImageDraw.Draw(sh)
    for i,l in enumerate(lines): ds.text(((w-ws[i])/2,pad+i*lh+4),l,font=font,fill=(0,0,0,175))
    sh=sh.filter(ImageFilter.GaussianBlur(9)); sh.alpha_composite(lay)
    return np.asarray(sh).astype(np.float32), max(ws)
def fit_font(lines,weight="SemiBold",size=76,maxw=900):
    d0=ImageDraw.Draw(Image.new("RGB",(4,4)))
    while True:
        f=inter(weight,size)
        if max(d0.textlength(l,font=f) for l in lines)<=maxw or size<50: return f
        size-=2
def blend(fr,sp,cx,cy,a=1.0,dx=0,dy=0):
    h,w=sp.shape[:2]; x=int(cx-w/2+dx); y=int(cy-h/2+dy)
    x0,y0=max(x,0),max(y,0); x1,y1=min(x+w,W),min(y+h,H)
    if x1<=x0 or y1<=y0 or a<=0: return
    s=sp[y0-y:y1-y,x0-x:x1-x]; al=s[...,3:4]/255.0*a
    fr[y0:y1,x0:x1]=fr[y0:y1,x0:x1]*(1-al)+s[...,:3]*al

CACHE={}
def chunk_sprites(i,c):
    if i in CACHE: return CACHE[i]
    f=fit_font(c["lines"],"Bold" if c.get("bold") else "SemiBold")
    if c["style"]=="x":
        full=c["lines"][0]; ex=c["exit_word"]; head=full[:len(full)-len(ex)]
        d0=ImageDraw.Draw(Image.new("RGB",(4,4)))
        wh=d0.textlength(head,font=f); wex=d0.textlength(ex,font=f); tot=wh+wex
        a,_=sprite([head.rstrip()],f); b,_=sprite([ex],f)
        # смещение центров, чтобы собранная строка стояла по центру
        res=dict(parts=[(a,-(tot-wh)/2+0.0 - 0),(b,(tot-wex)/2)],f=f,kind="x",wh=wh,wex=wex,tot=tot)
        whs=d0.textlength(head.rstrip(),font=f)
        res["parts"]=[(a,-tot/2+whs/2),(b,-tot/2+wh+wex/2)]
    else:
        sp,_=sprite(c["lines"],f); res=dict(parts=[(sp,0)],kind="n")
    CACHE[i]=res; return res

# ---------- лента новостей ----------
def build_feed():
    P=560; n=10; img=Image.new("RGB",(W,P*n),(16,13,10)); d=ImageDraw.Draw(img)
    tags=["СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО"]
    for i in range(n):
        y=i*P+20
        d.rounded_rectangle((70,y,1010,y+520),44,fill=(34,28,22),outline=(64,54,42),width=2)
        d.ellipse((106,y+34,166,y+94),fill=(86,72,56)); d.rounded_rectangle((184,y+46,420,y+62),8,fill=(96,82,64)); d.rounded_rectangle((184,y+72,330,y+84),6,fill=(66,56,44))
        d.rounded_rectangle((106,y+120,974,y+330),26,fill=(52,43,34))
        d.rounded_rectangle((106,y+352,860,y+380),12,fill=(150,132,104)); d.rounded_rectangle((106,y+398,640,y+420),10,fill=(92,78,62))
        f=inter("Bold",26); w=d.textlength(tags[i],font=f)
        d.rounded_rectangle((126,y+142,126+w+36,y+190),14,fill=(214,72,62)); d.text((144,y+148),tags[i],font=f,fill=(255,245,240))
    return np.asarray(img),P
FEEDIMG,PITCH=build_feed()
def feed_frame(t):
    sw=clamp((t-FEED["swipe"])/FEED["swipe_dur"]); off=PITCH*ease_out5(sw)
    vel=PITCH*5*(1-sw)**4/FEED["swipe_dur"] if 0<sw<1 else 0   # px/с
    base=PITCH*2-330 + off
    # лёгкое «дыхание» ленты до свайпа
    base+= 0 if t>=FEED["swipe"] else 6*math.sin((t-FEED["t0"])*9)*math.exp(-(t-FEED["t0"])*3)
    y0=int(base); fr=FEEDIMG[y0:y0+H].astype(np.float32)
    k=int(min(vel/60,28))
    if k>1:
        acc=np.zeros_like(fr); s=0
        for dy in range(-k,k+1,max(1,k//6)):
            acc+=np.roll(fr,dy,axis=0); s+=1
        fr=acc/s
    # касание пальцем: мягкий круг, едет вверх вместе со свайпом
    if FEED["swipe"]-0.18<=t<=FEED["swipe"]+FEED["swipe_dur"]+0.05:
        a=clamp((t-(FEED["swipe"]-0.18))/0.12)*clamp((FEED["swipe"]+FEED["swipe_dur"]+0.05-t)/0.12)
        cy=1420-PITCH*ease_out5(sw)*1.0
        yy,xx=np.ogrid[:H,:W]; m=np.clip(1-(((xx-540)**2+(yy-cy)**2)**0.5-44)/10,0,1)[...,None]*0.28*a
        fr=fr*(1-m)+np.array(IVORY,np.float32)*m
    return fr

# ---------- градиент под текстом ----------
def apply_gradient(fr,amt,wide,feed=False):
    if amt<=0.001: return
    y0,y1=850,1560; ys=np.arange(y0,y1); k=(ys-y0)/(y1-y0)
    a=np.where(k<0.4,k/0.4,np.where(k<0.62,1.0,np.maximum(0,(1-k)/0.38)))
    a=(a*(0.42 if wide else (0.86 if feed else 0.62))*amt)[:,None,None]
    a=np.clip(a,0,0.9)
    fr[y0:y1]=fr[y0:y1]*(1-a)+DARK*a

def chunk_alpha(c,t):
    pin=ease_out(clamp((t-c["t0"])/0.2)); pout=clamp((c["t1"]-t)/0.12)
    return pin*pout, (1-pin)*14
def render_subs(fr,t,wide,feed_on):
    cy=1200 if wide else 1150; act=[]; cx=770 if wide else 540
    amt=0
    for i,c in enumerate(SUBS):
        a,dy=chunk_alpha(c,t)
        if t>c["t0"]-0.15 and t<c["t1"]+0.2: amt=max(amt,clamp(min((t-(c["t0"]-0.15))/0.3,(c["t1"]+0.2-t)/0.3)))
        if a>0: act.append((i,c,a,dy))
    apply_gradient(fr,1.0 if feed_on else amt,wide and not feed_on,feed_on)
    for i,c,a,dy in act:
        if c["style"] in("n","x","g","f","q"):
            sp=chunk_sprites(i,c)
            if sp["kind"]=="x":
                ex=ease_in(clamp((t-c["exit_t"])/0.30)); 
                for k,(s,off) in enumerate(sp["parts"]):
                    if k==1: blend(fr,s,cx+off,cy,a*(1-ex),dx=ex*320,dy=dy)
                    else: blend(fr,s,cx+off,cy,a,dy=dy)
            else: blend(fr,sp["parts"][0][0],cx,cy,a,dy=dy)

def main():
    dur=T1-T0; n=int(round(dur*FPS))
    dec=subprocess.Popen(["ffmpeg","-v","error","-ss",f"{T0}","-i",SRC,"-t",f"{dur}","-vf",f"fps={FPS}","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE)
    enc=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-i",os.environ["AUDIO_WAV"],
        "-map","0:v","-map","1:a","-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709",
        "-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",OUT],stdin=subprocess.PIPE)
    for k in range(n):
        t=T0+k/FPS
        raw=dec.stdout.read(W*H*3)
        if len(raw)<W*H*3: break
        fr=np.frombuffer(raw,np.uint8).reshape(H,W,3).astype(np.float32)
        # возврат к лицу: лёгкий наезд после ленты
        r=t-FEED["t1"]
        if 0<=r<0.30:
            z=1+0.05*(1-ease_out(r/0.30)); im=Image.fromarray(fr.astype(np.uint8)); w2,h2=int(W/z),int(H/z)
            im=im.crop(((W-w2)//2,(H-h2)//2,(W-w2)//2+w2,(H-h2)//2+h2)).resize((W,H),Image.BICUBIC); fr=np.asarray(im).astype(np.float32)
        wide=CUT_WIDE[0]<=t<CUT_WIDE[1]
        fa=0.0
        if FEED["t0"]<=t<FEED["t1"]+FEED["xfade"]:
            fa=min(clamp((t-FEED["t0"])/FEED["xfade"]),clamp((FEED["t1"]+FEED["xfade"]-t)/FEED["xfade"]))
        if fa>0:
            ff=feed_frame(t); fr=fr*(1-fa)+ff*fa
        render_subs(fr,t,wide,fa>0.5)
        # входной/выходной микро-фейд клипа
        fade=min(1,(t-T0)/0.10,(T1-t)/0.20); fr=fr*fade
        enc.stdin.write(np.clip(fr,0,255).astype(np.uint8).tobytes())
    enc.stdin.close(); enc.wait(); dec.stdout.close(); dec.wait()
main()
