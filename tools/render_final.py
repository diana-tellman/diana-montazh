# Финальный рендер. python3 -I tools/render_final.py <source.mov> <t_start> <t_end> <out.mp4>   (звук: env AUDIO_WAV)
import sys, subprocess, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from subs_final import SUBS
SRC,T0,T1,OUT=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
W,H,FPS=1080,1920,30
IVORY=(246,239,226); GOLD=(236,200,124); SOFT=(222,212,196); DARK=np.array([10,8,7],np.float32)
FD="/usr/share/fonts/opentype/inter/"
def inter(w,s): return ImageFont.truetype(FD+f"InterDisplay-{w}.otf",s)
def serif_i(s): return ImageFont.truetype("/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf",s)
CUT_WIDE=(9.2,24.1); SIZE=76; LHK=1.22; LEAD=0.08
FEED=dict(t0=29.62,swipe=30.58,swipe_dur=0.42,back=31.38,xfade=0.10)
def clamp(x,a=0.0,b=1.0): return min(max(x,a),b)
def ease_out(x): x=clamp(x); return 1-(1-x)**3
def ease_out4(x): x=clamp(x); return 1-(1-x)**4
def ease_out5(x): x=clamp(x); return 1-(1-x)**5
def ease_in(x): x=clamp(x); return x*x
def ease_io(x): x=clamp(x); return 3*x*x-2*x**3
def ease_back(x): x=clamp(x); c=1.9; return 1+(c+1)*(x-1)**3+c*(x-1)**2
_d0=ImageDraw.Draw(Image.new("RGB",(4,4)))
def tlen(t,f): return _d0.textlength(t,font=f)
DUR=dict(rise=0.28,mask=0.24,pop=0.30,left=0.26,right=0.26,blur=0.34,words=0.24)

# ---------- раскладка: слова-токены, обычные пробелы, блок по центру ----------
def font_of(c,s):
    if c.get("style")=="q": return serif_i(s.get("size") or 84)
    return inter("Bold" if (s["bold"] or c.get("bold")) else "SemiBold", s.get("size") or SIZE)
def layout(c):
    if "_lay" in c: return c["_lay"]
    lines=[]
    for ln in c["lines"]:
        segs=ln if isinstance(ln,list) else [dict(text=ln,t=None,bold=False,size=None,color=None)]
        lines.append(segs)
    size=SIZE
    while True:   # вписать в 860 px
        rows=[];ok=True
        for segs in lines:
            toks=[];x=0
            for s in segs:
                f=font_of(c,s); sp=tlen(" ",f)
                for w in s["text"].split(" "):
                    toks.append(dict(text=w,x=x,w=tlen(w,f),f=f,t=s["t"] if s["t"] is not None else c["t0"],color=s.get("color") or (SOFT if c.get("style")=="q" else (GOLD if c.get("style")=="g" else IVORY)),size=f.size))
                    x+=tlen(w,f)+sp
            wtot=x-sp; rows.append(dict(toks=toks,w=wtot,size=max(t["size"] for t in toks)))
        if max(r["w"] for r in rows)<=860: break
        break
    tot=sum(int(r["size"]*LHK) for r in rows); y=-tot/2
    for r in rows:
        lh=int(r["size"]*LHK); r["lh"]=lh; r["cy"]=y+lh/2; y+=lh
        for t in r["toks"]: t["x"]-=r["w"]/2
    c["_lay"]=dict(rows=rows,w=max(r["w"] for r in rows),h=tot); return c["_lay"]

SPR={}
def tok_sprite(text,f,fill,glow=False,pad=34):
    key=(text,f.path,f.size,fill,glow)
    if key in SPR: return SPR[key]
    w=int(math.ceil(tlen(text,f)))+2*pad; h=int(f.size*1.5)+2*pad
    lay=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(lay); d.text((pad,pad),text,font=f,fill=fill+(255,))
    sh=Image.new("RGBA",(w,h),(0,0,0,0)); ds=ImageDraw.Draw(sh); ds.text((pad,pad+4),text,font=f,fill=(0,0,0,175))
    sh=sh.filter(ImageFilter.GaussianBlur(9)); sh.alpha_composite(lay)
    halo=None
    if glow:
        hl=Image.new("RGBA",(w,h),(0,0,0,0)); dh=ImageDraw.Draw(hl); dh.text((pad,pad),text,font=f,fill=GOLD+(255,))
        halo=hl.filter(ImageFilter.GaussianBlur(20))
    SPR[key]=(sh,halo,pad); return SPR[key]
def blend(fr,im,x,y,a=1.0,clip=None):
    sp=np.asarray(im).astype(np.float32); h,w=sp.shape[:2]; x=int(round(x)); y=int(round(y))
    x0,y0=max(x,0),max(y,0); x1,y1=min(x+w,W),min(y+h,H)
    if clip: y0=max(y0,int(clip[0])); y1=min(y1,int(clip[1]))
    if x1<=x0 or y1<=y0 or a<=0: return
    s=sp[y0-y:y1-y,x0-x:x1-x]; al=s[...,3:4]/255.0*a
    fr[y0:y1,x0:x1]=fr[y0:y1,x0:x1]*(1-al)+s[...,:3]*al

# ---------- разные появления ----------
def anim_params(kind,p,lh):
    """p 0..1 -> dx,dy,scale,alpha,blur,clip?"""
    e=ease_out4(p)
    if kind=="rise":  return 0,(1-e)*46,1,clamp(p*1.6),0,False
    if kind=="mask":  return 0,(1-e)*lh*0.95,1,clamp(p*1.8),0,True
    if kind=="pop":   return 0,0,0.78+0.22*ease_back(p),clamp(p*2.4),0,False
    if kind=="left":  return -(1-e)*130,0,1,clamp(p*1.7),0,False
    if kind=="right": return (1-e)*130,0,1,clamp(p*1.7),0,False
    if kind=="blur":  return 0,0,1.10-0.10*e,clamp(p*1.5),(1-e)*9,False
    return 0,(1-e)*36,1,clamp(p*1.7),0,False        # words
def eff_end(c): return c["_t1"]
def draw_chunk(fr,c,t,cx,cy):
    L=layout(c); st=c.get("style"); kind=c.get("anim","rise"); out=clamp((eff_end(c)-t)/0.10)
    if st=="q": return draw_quote(fr,c,t,L,out)
    glowf=0.55+0.15*math.sin((t-c["t0"])*3.2) if st=="g" else 0
    wi=0
    for li,r in enumerate(L["rows"]):
        for ti,k in enumerate(r["toks"]):
            kk=kind; delay=(wi*0.085 if kind=="words" else li*0.05); 
            if st=="f": kk="pop" if k["t"]>42 else "rise"; delay=0
            ts=max(k["t"],c["t0"]) -LEAD+delay; wi+=1
            p=(t-ts)/(DUR[kk] if st!="f" else 0.30)
            if p<=0: continue
            p=clamp(p); dx,dy,sc,al,bl,clip=anim_params(kk,p,r["lh"])
            if "exit_word" in c and k["text"]==c["exit_word"]:
                ex=ease_in((t-c["exit_t"])/0.30); dx+=ex*330; al*=1-ex
            sh,halo,pad=tok_sprite(k["text"],k["f"],k["color"],glow=(st=="g"))
            im=sh
            if sc!=1 or bl>0.3:
                w2,h2=int(im.width*sc),int(im.height*sc)
                if sc!=1: im=im.resize((max(1,w2),max(1,h2)),Image.BICUBIC)
                if bl>0.3: im=im.filter(ImageFilter.GaussianBlur(bl))
            x=cx+k["x"]-pad-(im.width-sh.width)/2+dx; y=cy+r["cy"]-sh.height/2-(im.height-sh.height)/2+dy
            if halo is not None: blend(fr,halo,x,y,a=al*out*glowf*1.2)
            top=cy+r["cy"]-r["lh"]*0.62; bot=cy+r["cy"]+r["lh"]*0.62+12
            blend(fr,im,x,y,a=al*out,clip=(top,bot) if clip else None)

def draw_quote(fr,c,t,L,out):
    # метка «КОГДА ГОВОРЯТ»: проявляется, сжимая разрядку
    p=ease_out(clamp((t-c["label_t"]+0.05)/0.45))
    if p>0:
        f=inter("SemiBold",34); sp=7+(1-p)*12; txt=c["label"]; w=sum(tlen(ch,f)+sp for ch in txt)-sp; x=540-w/2
        lay=Image.new("RGBA",(W,90),(0,0,0,0)); d=ImageDraw.Draw(lay)
        for ch in txt: d.text((x,20),ch,font=f,fill=GOLD+(255,)); x+=tlen(ch,f)+sp
        sh=lay.filter(ImageFilter.GaussianBlur(6)); sh2=Image.new("RGBA",(W,90),(0,0,0,0)); sh2.paste((0,0,0,140),mask=sh.getchannel("A").point(lambda v:v//2)); sh2.alpha_composite(lay)
        blend(fr,sh2,0,1010-45+(1-p)*16,a=p*out)
    # цитатная планка
    pb=ease_out(clamp((t-c["t0"]+0.1)/0.4)); hgt=int(210*pb)
    if hgt>2:
        bar=Image.new("RGBA",(8,hgt),GOLD+(255,)); blend(fr,bar,86,1052,a=out)
    # строки цитаты: появляются слева направо из-за края, синхронно со словами
    for li,r in enumerate(L["rows"]):
        cyy=[1103,1200][li]
        for k in r["toks"]:
            ts=k["t"]-LEAD; p=ease_out4((t-ts)/0.30)
            if p<=0: continue
            sh,_,pad=tok_sprite(k["text"],k["f"],k["color"])
            x=122+(k["x"]+r["w"]/2)-pad+(1-p)*40; y=cyy-sh.height/2
            blend(fr,sh,x,y,a=clamp(p*1.6)*out)

# ---------- градиент (как в первой версии, но мягче) ----------
def apply_gradient(fr,amt,wide,feed=False):
    if amt<=0.001: return
    y0,y1=850,1560; ys=np.arange(y0,y1); k=(ys-y0)/(y1-y0)
    a=np.where(k<0.4,k/0.4,np.where(k<0.62,1.0,np.maximum(0,(1-k)/0.38)))
    a=(a*(0.36 if wide else (0.84 if feed else 0.58))*amt)[:,None,None]; a=np.clip(a,0,0.9)
    fr[y0:y1]=fr[y0:y1]*(1-a)+DARK*a

# ---------- лента новостей (как в первой версии) ----------
def build_feed():
    P=560; n=10; img=Image.new("RGB",(W,P*n),(16,13,10)); d=ImageDraw.Draw(img)
    tags=["СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО","ШОК","СКАНДАЛ","СРОЧНО"]
    for i in range(n):
        y=i*P+20
        d.rounded_rectangle((70,y,1010,y+520),44,fill=(34,28,22),outline=(64,54,42),width=2)
        d.ellipse((106,y+34,166,y+94),fill=(86,72,56)); d.rounded_rectangle((184,y+46,420,y+62),8,fill=(96,82,64)); d.rounded_rectangle((184,y+72,330,y+84),6,fill=(66,56,44))
        d.rounded_rectangle((106,y+120,974,y+330),26,fill=(52,43,34))
        d.rounded_rectangle((106,y+352,860,y+380),12,fill=(150,132,104)); d.rounded_rectangle((106,y+398,640,y+420),10,fill=(92,78,62))
        f=inter("Bold",26); w=tlen(tags[i],f)
        d.rounded_rectangle((126,y+142,126+w+36,y+190),14,fill=(214,72,62)); d.text((144,y+148),tags[i],font=f,fill=(255,245,240))
    return np.asarray(img),P
FEEDIMG,PITCH=build_feed()
def feed_frame(t):
    sw=clamp((t-FEED["swipe"])/FEED["swipe_dur"]); off=PITCH*ease_out5(sw)
    vel=PITCH*5*(1-sw)**4/FEED["swipe_dur"] if 0<sw<1 else 0
    base=PITCH*2-330+off
    base+=0 if t>=FEED["swipe"] else 6*math.sin((t-FEED["t0"])*9)*math.exp(-(t-FEED["t0"])*3)
    y0=int(base); fr=FEEDIMG[y0:y0+H].astype(np.float32)
    k=int(min(vel/60,28))
    if k>1:
        acc=np.zeros_like(fr); s=0
        for dy in range(-k,k+1,max(1,k//6)): acc+=np.roll(fr,dy,axis=0); s+=1
        fr=acc/s
    if FEED["swipe"]-0.18<=t<=FEED["swipe"]+FEED["swipe_dur"]+0.05:
        a=clamp((t-(FEED["swipe"]-0.18))/0.12)*clamp((FEED["swipe"]+FEED["swipe_dur"]+0.05-t)/0.12)
        cy=1420-PITCH*ease_out5(sw)
        yy,xx=np.ogrid[:H,:W]; m=np.clip(1-(((xx-540)**2+(yy-cy)**2)**0.5-44)/10,0,1)[...,None]*0.28*a
        fr=fr*(1-m)+np.array(IVORY,np.float32)*m
    return fr

def zoom(u8,z,ax,ay):
    if z<=1.0005: return u8.astype(np.float32)
    w2,h2=W/z,H/z; x0=ax*(1-1/z); y0=ay*(1-1/z)
    im=Image.fromarray(u8).resize((W,H),Image.BICUBIC,box=(x0,y0,x0+w2,y0+h2)); return np.asarray(im).astype(np.float32)

def prep():
    cs=sorted(SUBS,key=lambda c:c["t0"])
    for i,c in enumerate(cs):
        c["_t1"]=c["t1"]
        if i+1<len(cs) and cs[i+1]["t0"]-LEAD-0.01<c["_t1"] and cs[i+1].get("style")!="q": c["_t1"]=max(c["t0"]+0.3,cs[i+1]["t0"]-LEAD-0.01)
    for c in cs:
        if c.get("style")=="f": c["_t1"]=1e9      # финал держится до конца файла

def main():
    prep(); dur=T1-T0; n=int(round(dur*FPS))
    dec=subprocess.Popen(["ffmpeg","-v","error","-ss",f"{T0}","-i",SRC,"-t",f"{dur}","-vf",f"fps={FPS}","-f","rawvideo","-pix_fmt","rgb24","-"],stdout=subprocess.PIPE)
    enc=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-i",os.environ["AUDIO_WAV"],
        "-map","0:v","-map","1:a","-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709",
        "-c:a","aac","-b:a","192k","-movflags","+faststart","-shortest",OUT],stdin=subprocess.PIPE)
    for k in range(n):
        t=T0+k/FPS; raw=dec.stdout.read(W*H*3)
        if len(raw)<W*H*3: break
        u8=np.frombuffer(raw,np.uint8).reshape(H,W,3)
        # масштаб: «это не так» — акцент на лицо; финальный крупный план; возврат после ленты
        z=1.0; ax,ay=540,640
        if 4.58<=t<6.9:  z=1+0.035*(ease_out((t-4.58)/0.45) if t<5.9 else 1-ease_io((t-5.9)/1.0))
        r=t-FEED["back"]
        if 0<=r<0.30: z=1+0.05*(1-ease_out(r/0.30)); ax,ay=540,960
        if t>=40.6: z=1+0.20*ease_io((t-40.6)/1.2); ax,ay=540,1278
        fr=zoom(u8,z,ax,ay)
        wide=CUT_WIDE[0]<=t<CUT_WIDE[1]
        fa=0.0
        if FEED["t0"]<=t<FEED["back"]+FEED["xfade"]:
            fa=min(clamp((t-FEED["t0"])/FEED["xfade"]),clamp((FEED["back"]+FEED["xfade"]-t)/FEED["xfade"]))
        if fa>0: fr=fr*(1-fa)+feed_frame(t)*fa
        # цитата: лёгкое притемнение лица, снимается на «это не так»
        dim=0.0
        if 0.15<=t<4.58: dim=0.13*ease_out((t-0.15)/0.5)
        elif 4.58<=t<4.9: dim=0.13*(1-ease_out((t-4.58)/0.3))
        if dim>0: fr=fr*(1-dim)
        amt=0.0; act=[]
        for c in SUBS:
            if c["t0"]-LEAD-0.15<t<c["_t1"]+0.2:
                amt=max(amt,clamp(min((t-(c["t0"]-LEAD-0.15))/0.3,(c["_t1"]+0.2-t)/0.3)))
            if min(c["t0"],c.get("label_t",9e9))-LEAD-0.3<=t<=c["_t1"]: act.append(c)
        apply_gradient(fr,1.0 if fa>0.5 else amt,wide and fa<=0.5,fa>0.5)
        for c in act:
            L=layout(c)
            if c.get("style")=="q": draw_chunk(fr,c,t,540,1150); continue
            if wide and fa<=0.5: cx=min(770,960-L["w"]/2); cy=1200
            else: cx=540; cy=1150
            if c.get("style")=="f": cy=1135
            draw_chunk(fr,c,t,cx,cy)
        enc.stdin.write(np.clip(fr,0,255).astype(np.uint8).tobytes())
    enc.stdin.close(); enc.wait(); dec.stdout.close(); dec.wait()
main()
