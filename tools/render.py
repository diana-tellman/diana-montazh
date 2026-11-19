# Рендер монтажа v2. python3 -I tools/render.py <source.mov> <t_start> <t_end> <out.mp4>
import sys, subprocess, math, os
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
CY_BLOCK=int(H*0.65)            # центр блока субтитров: 65 % высоты (1248 px)
SIZE=62; LH=int(SIZE*1.14)      # компактный кегль, строки сближены
APPEAR=0.22; LEAD=0.08          # появление ≈0,2 с, начинается чуть раньше слова
FEED=dict(t0=29.62, swipe=30.58, swipe_dur=0.42, back=31.40, xfade=0.10)
SEGM=os.environ.get("SEGMODEL","")
def clamp(x,a=0.0,b=1.0): return min(max(x,a),b)
def ease_out(x): x=clamp(x); return 1-(1-x)**3
def ease_out4(x): x=clamp(x); return 1-(1-x)**4
def ease_io(x): x=clamp(x); return 3*x*x-2*x**3

_d0=ImageDraw.Draw(Image.new("RGB",(4,4)))
def font_for(seg_bold,size=SIZE): return inter("Bold" if seg_bold else "SemiBold",size)
def tlen(t,f): return _d0.textlength(t,font=f)

# ---------- сегменты и строки ----------
def norm_lines(c):
    out=[]
    for ln in c["lines"]:
        segs=ln if isinstance(ln,list) else [dict(text=ln,t=None,bold=c.get("bold",False))]
        out.append([dict(text=s["text"],t=s["t"] if s["t"] is not None else c["t0"],bold=s["bold"] or c.get("bold",False)) for s in segs])
    return out
def layout(c):
    """Позиции сегментов в строке: один обычный пробел между словами, строка по центру."""
    if "_lay" in c: return c["_lay"]
    size=SIZE; lines=norm_lines(c)
    while True:  # вписать в 800 px
        fs=[[font_for(s["bold"],size) for s in ln] for ln in lines]
        ws=[]
        for ln,fl in zip(lines,fs):
            w=sum(tlen(s["text"],f) for s,f in zip(ln,fl))+sum(tlen(" ",fl[0]) for _ in ln[1:])
            ws.append(w)
        if max(ws)<=800 or size<48: break
        size-=2
    lh=int(size*1.14); n=len(lines); res=[]
    for i,(ln,fl,w) in enumerate(zip(lines,fs,ws)):
        cyl=CY_BLOCK+(i-(n-1)/2)*lh; x=-w/2; segs=[]
        for s,f in zip(ln,fl):
            sw=tlen(s["text"],f); segs.append(dict(s,x=x,w=sw,f=f)); x+=sw+tlen(" ",fl[0])
        res.append(dict(cy=cyl,w=w,segs=segs))
    c["_lay"]=dict(lines=res,size=size,lh=lh,w=max(ws),n=n); return c["_lay"]

def _prep():
    cs=sorted(SUBS,key=lambda c:c["t0"])
    for i,c in enumerate(cs):
        c["_t1"]=c["t1"]
        if i+1<len(cs) and cs[i+1]["t0"]-LEAD-0.01<c["_t1"]: c["_t1"]=max(c["t0"]+0.3,cs[i+1]["t0"]-LEAD-0.01)
SPR={}
def seg_sprite(text,f,fill=IVORY,pad=28):
    key=(text,f.path,f.size,fill)
    if key in SPR: return SPR[key]
    w=int(math.ceil(tlen(text,f)))+2*pad; h=int(f.size*1.5)+2*pad
    lay=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(lay)
    # тонкая тёмная обводка + мягкая тень: читаются и на светлой блузке
    d.text((pad,pad),text,font=f,fill=fill+(255,),stroke_width=2,stroke_fill=(16,11,9,150))
    sh=Image.new("RGBA",(w,h),(0,0,0,0)); ds=ImageDraw.Draw(sh)
    ds.text((pad,pad+3),text,font=f,fill=(0,0,0,170),stroke_width=2,stroke_fill=(0,0,0,170))
    sh=sh.filter(ImageFilter.GaussianBlur(6)); sh.alpha_composite(lay)
    SPR[key]=(np.asarray(sh).astype(np.float32),pad); return SPR[key]

def blend(fr,sp,x,y,a=1.0,clip=None):
    h,w=sp.shape[:2]; x=int(round(x)); y=int(round(y))
    x0,y0=max(x,0),max(y,0); x1,y1=min(x+w,W),min(y+h,H)
    if clip: y0=max(y0,int(clip[0])); y1=min(y1,int(clip[1]))
    if x1<=x0 or y1<=y0 or a<=0: return
    s=sp[y0-y:y1-y,x0-x:x1-x]; al=s[...,3:4]/255.0*a
    fr[y0:y1,x0:x1]=fr[y0:y1,x0:x1]*(1-al)+s[...,:3]*al

# ---------- подпись: проявление снизу из-за невидимого края ----------
def draw_chunk(fr,c,t,cx):
    L=layout(c); out_a=clamp((c["_t1"]-t)/0.08)
    for li,ln in enumerate(L["lines"]):
        for s in ln["segs"]:
            ts=s["t"]-LEAD+li*0.05
            p=ease_out4((t-ts)/APPEAR)
            if p<=0: continue
            sp,pad=seg_sprite(s["text"],s["f"])
            top=ln["cy"]-L["lh"]*0.62; bot=ln["cy"]+L["lh"]*0.62+10   # «невидимый край» — рамка строки
            dy=(1-p)*L["lh"]*0.95
            x=cx+s["x"]-pad; y=ln["cy"]-sp.shape[0]/2+dy
            blend(fr,sp,x,y,a=clamp(p*1.8)*out_a,clip=(top,bot))
    return L

UL=(232,164,44)   # насыщенный янтарь: виден и на светлой блузке
def draw_underline(fr,c,t,cx):
    u=c["underline"]; L=layout(c); ln=L["lines"][0]
    seg=[s for s in ln["segs"] if s["text"].startswith(u["word"])][0]
    f=seg["f"]; xs=cx+seg["x"]; xe=xs+tlen(u["word"],f)
    base=ln["cy"]+L["size"]*0.365; y0=base+L["size"]*0.30
    prog=ease_io((t-u["t0"])/(u["t1"]-u["t0"]))
    if prog<=0: return
    out_a=clamp((c["_t1"]-t)/0.08)
    n=70; pts=[]
    for i in range(n+1):
        k=i/n; x=xs-6+(xe-xs+14)*k
        y=y0-4.5*k+2.2*math.sin(k*9.5+0.6)+1.1*math.sin(k*23)   # лёгкая «рукописная» волна и подъём
        pts.append((x,y))
    K=max(1,int(n*prog)); pad=20
    bx0=int(xs-pad); by0=int(y0-pad); bw=int(xe-xs+14+2*pad); bh=int(2*pad+14)
    S=3; lay=Image.new("RGBA",(bw*S,bh*S),(0,0,0,0)); d=ImageDraw.Draw(lay)
    for i in range(K):
        k=i/n; wdt=(2.2+4.2*math.sin(math.pi*min(1,k*1.1+0.04)))*S/1.0   # тонкая линия, сужается к концам
        (xa,ya),(xb,yb)=pts[i],pts[i+1]
        a=((xa-bx0)*S,(ya-by0)*S); b=((xb-bx0)*S,(yb-by0)*S)
        d.line([a,b],fill=UL+(255,),width=max(2,int(wdt))); d.ellipse((a[0]-wdt/2,a[1]-wdt/2,a[0]+wdt/2,a[1]+wdt/2),fill=UL+(255,))
    lay=lay.resize((bw,bh),Image.LANCZOS)
    sh=lay.copy(); sh=Image.merge("RGBA",(Image.new("L",lay.size,0),)*3+(lay.getchannel("A").point(lambda v:int(v*0.85)),)).filter(ImageFilter.GaussianBlur(3))
    sh.alpha_composite(lay)
    blend(fr,np.asarray(sh).astype(np.float32),bx0,by0+2,a=out_a)

# ---------- локальное мягкое затемнение под подписью ----------
def local_dark(fr,c,t,cx,strength):
    L=layout(c); a_in=ease_out(clamp((t-(c["t0"]-0.15))/0.30)); a_out=clamp((c["_t1"]+0.10-t)/0.25)
    a=a_in*a_out*strength
    if a<=0.01: return
    rx=L["w"]/2+190; ry=L["n"]*L["lh"]/2+120
    x0,x1=int(max(cx-rx,0)),int(min(cx+rx,W)); y0,y1=int(CY_BLOCK-ry),int(min(CY_BLOCK+ry,H))
    xx=(np.arange(x0,x1)-cx)/rx; yy=(np.arange(y0,y1)-CY_BLOCK)/ry
    d2=xx[None,:]**2+yy[:,None]**2; m=np.clip(1-d2,0,1)**1.6*a
    fr[y0:y1,x0:x1]=fr[y0:y1,x0:x1]*(1-m[...,None])+DARK*m[...,None]

# ---------- лента новостей: карточка уходит вверх, как при движении пальцем ----------
CARD_H=700; PITCH=800; SLOT=250
def build_feed():
    n=6; img=Image.new("RGB",(W,PITCH*n),(14,11,9)); d=ImageDraw.Draw(img)
    tags=["СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО","ШОК","СКАНДАЛ"]; hl=[(780,560),(820,420),(700,600),(800,500),(760,540),(820,460)]
    for i in range(n):
        y=i*PITCH+50; x0,x1=90,990
        d.rounded_rectangle((x0,y,x1,y+CARD_H),46,fill=(36,30,24),outline=(70,59,46),width=2)
        d.ellipse((x0+36,y+34,x0+100,y+98),fill=(92,77,60)); d.rounded_rectangle((x0+122,y+46,x0+400,y+64),9,fill=(104,88,68)); d.rounded_rectangle((x0+122,y+76,x0+270,y+90),7,fill=(70,59,46))
        d.rounded_rectangle((x0+36,y+122,x1-36,y+420),30,fill=(58,48,38))
        d.polygon([(x0+36,y+420-70),(x0+230,y+250),(x0+380,y+360),(x0+520,y+280),(x1-36,y+400),(x1-36,y+390),(x1-36,y+420-0),(x0+36,y+420)],fill=(70,58,45))
        f=inter("Bold",30); w=tlen(tags[i],f)
        d.rounded_rectangle((x0+58,y+144,x0+58+w+44,y+198),16,fill=(214,72,62)); d.text((x0+80,y+152),tags[i],font=f,fill=(255,245,240))
        a,b=hl[i]; d.rounded_rectangle((x0+36,y+450,x0+36+a,y+484),14,fill=(160,141,112)); d.rounded_rectangle((x0+36,y+506,x0+36+b,y+534),12,fill=(98,83,65))
        for k in range(3): d.ellipse((x0+36+k*120,y+590,x0+36+k*120+44,y+634),fill=(84,71,56)); d.rounded_rectangle((x0+36+k*120+56,y+604,x0+36+k*120+104,y+620),7,fill=(66,56,44))
    return np.asarray(img)
FEEDIMG=build_feed()
def feed_frame(t):
    sw=clamp((t-FEED["swipe"])/FEED["swipe_dur"]); prog=ease_out4(sw)
    vel=(PITCH*4*(1-sw)**3/FEED["swipe_dur"]) if 0<sw<1 else 0
    off=PITCH*prog
    base=PITCH*2+50-SLOT+off    # карточка №2 стоит в «слоте», по свайпу уезжает вверх, снизу выезжает №3
    if t<FEED["swipe"]: base+=5*math.sin((t-FEED["t0"])*10)*math.exp(-(t-FEED["t0"])*3.5)
    y0=int(base); fr=FEEDIMG[y0:y0+H].astype(np.float32)
    k=int(min(vel/55,26))
    if k>1:
        acc=np.zeros_like(fr); s=0
        for dy in range(-k,k+1,max(1,k//6)): acc+=np.roll(fr,dy,axis=0); s+=1
        fr=acc/s
    # палец: мягкий круг, тянет карточку вверх
    t_a=FEED["swipe"]-0.20; t_b=FEED["swipe"]+FEED["swipe_dur"]+0.04
    if t_a<=t<=t_b:
        a=clamp((t-t_a)/0.12)*clamp((t_b-t)/0.14); cy=880-520*prog; cx=620
        yy,xx=np.ogrid[:H,:W]; m=np.clip(1-(((xx-cx)**2+(yy-cy)**2)**0.5-46)/12,0,1)[...,None]*0.30*a
        fr=fr*(1-m)+np.array(IVORY,np.float32)*m
    # невидимые края: сверху карточка тает, снизу лента растворяется до подписи
    ys=np.arange(H); mk=np.clip((ys-90)/150,0,1)*np.clip((1080-ys)/110,0,1); bg=np.array([14,11,9],np.float32)
    return fr*mk[:,None,None]+bg*(1-mk[:,None,None])

# ---------- «НИКОГДА» за силуэтом ----------
class Matte:
    def __init__(s):
        import onnxruntime as ort
        s.sess=ort.InferenceSession(SEGM,providers=["CPUExecutionProvider"]); s.prev=None
    def get(s,fr_u8,reset=False):
        im=Image.fromarray(fr_u8).resize((320,320),Image.LANCZOS)
        x=np.asarray(im).astype(np.float32); x/=x.max(); x=((x-[0.485,0.456,0.406])/[0.229,0.224,0.225]).transpose(2,0,1)[None].astype(np.float32)
        y=s.sess.run(None,{s.sess.get_inputs()[0].name:x})[0][0,0]; y=(y-y.min())/(y.max()-y.min()+1e-6)
        m=np.asarray(Image.fromarray((y*255).astype(np.uint8)).resize((W,H),Image.BICUBIC)).astype(np.float32)/255
        m=np.clip((m-0.28)/0.34,0,1); m=np.asarray(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32)/255
        if s.prev is not None and not reset: m=0.55*m+0.45*s.prev
        s.prev=m; return m
BIG=None
def big_sprite(text):
    global BIG
    if BIG is None:
        size=172; f=inter("Black",size)
        while tlen(text,f)>940: size-=4; f=inter("Black",size)
        w=int(tlen(text,f))+80; h=int(size*1.4)+80
        lay=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(lay)
        d.text((40,40),text,font=f,fill=IVORY+(255,),stroke_width=5,stroke_fill=(22,15,10,170))
        sh=Image.new("RGBA",(w,h),(0,0,0,0)); ds=ImageDraw.Draw(sh); ds.text((40,46),text,font=f,fill=(0,0,0,150),stroke_width=5,stroke_fill=(0,0,0,150))
        sh=sh.filter(ImageFilter.GaussianBlur(10)); sh.alpha_composite(lay); BIG=np.asarray(sh).astype(np.float32)
    return BIG
def draw_bigword(fr_f,fr_u8,c,t,matte,first):
    b=c["bigword"]; p=ease_out((t-b["t0"]+0.06)/0.30); o=clamp((b["t1"]-t)/0.14)
    if p<=0 or o<=0: return
    m=matte.get(fr_u8,reset=first)
    sp=big_sprite(b["text"]); sc=1.07-0.07*p
    if abs(sc-1)>0.002:
        im=Image.fromarray(sp.astype(np.uint8),"RGBA"); im=im.resize((int(im.width*sc),int(im.height*sc)),Image.BICUBIC); sp=np.asarray(im).astype(np.float32)
    h,w=sp.shape[:2]; x=int(540-w/2); y=int(445-h/2)
    layer=np.zeros((H,W,4),np.float32)
    x0,y0=max(x,0),max(y,0); x1,y1=min(x+w,W),min(y+h,H); layer[y0:y1,x0:x1]=sp[y0-y:y1-y,x0-x:x1-x]
    al=layer[...,3:4]/255.0*p*o*(1-m[...,None])      # текст виден только там, где героини нет
    fr_f[...]=fr_f*(1-al)+layer[...,:3]*al

def main():
    _prep()
    dur=T1-T0; n=int(round(dur*FPS)); matte=Matte() if SEGM else None
    dec=subprocess.Popen(["ffmpeg","-v","error","-ss",f"{T0}","-i",SRC,"-t",f"{dur}","-vf",f"fps={FPS}","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE)
    enc=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-i",os.environ["AUDIO_WAV"],
        "-map","0:v","-map","1:a","-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709",
        "-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",OUT],stdin=subprocess.PIPE)
    first_big=True
    for k in range(n):
        t=T0+k/FPS; raw=dec.stdout.read(W*H*3)
        if len(raw)<W*H*3: break
        u8=np.frombuffer(raw,np.uint8).reshape(H,W,3); fr=u8.astype(np.float32)
        r=t-FEED["back"]
        if 0<=r<0.30:   # возврат к лицу: лёгкий наезд
            z=1+0.05*(1-ease_out(r/0.30)); im=Image.fromarray(u8); w2,h2=int(W/z),int(H/z)
            im=im.crop(((W-w2)//2,(H-h2)//2,(W-w2)//2+w2,(H-h2)//2+h2)).resize((W,H),Image.BICUBIC); fr=np.asarray(im).astype(np.float32)
        wide=CUT_WIDE[0]<=t<CUT_WIDE[1]
        # слово за силуэтом — до подписей, по чистому кадру
        for c in SUBS:
            if "bigword" in c and matte and c["bigword"]["t0"]-0.1<=t<=c["bigword"]["t1"]+0.05:
                draw_bigword(fr,u8,c,t,matte,first_big); first_big=False
        fa=0.0
        if FEED["t0"]<=t<FEED["back"]+FEED["xfade"]:
            fa=min(clamp((t-FEED["t0"])/FEED["xfade"]),clamp((FEED["back"]+FEED["xfade"]-t)/FEED["xfade"]))
        if fa>0: fr=fr*(1-fa)+feed_frame(t)*fa
        cx=660 if wide else 540
        act=[c for c in SUBS if c["t0"]-LEAD-0.2<=t<=c["t1"]+0.3 and c.get("style") not in("q",)]
        for c in act: local_dark(fr,c,t,cx,0.30 if wide else (0.34 if fa>0.5 else 0.52))
        for c in act:
            if t<=c["_t1"]:
                draw_chunk(fr,c,t,cx)
                if "underline" in c: draw_underline(fr,c,t,cx)
        fade=min(1,(t-T0)/0.10,(T1-t)/0.20); fr=fr*fade
        enc.stdin.write(np.clip(fr,0,255).astype(np.uint8).tobytes())
    enc.stdin.close(); enc.wait(); dec.stdout.close(); dec.wait()
main()
