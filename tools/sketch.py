# Эскизы на реальных кадрах исходника. Запуск: python3 -I tools/sketch.py <source.mov> <out_dir>
import sys, subprocess, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
SRC, OUT = sys.argv[1], sys.argv[2]
W, H = 1080, 1920
IVORY=(246,239,226); GOLD=(236,200,124); SOFT=(222,212,196)
F="/usr/share/fonts/opentype/inter/"
def inter(w,s): return ImageFont.truetype(F+f"InterDisplay-{w}.otf", s)
def serif_i(s): return ImageFont.truetype("/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf", s)

def frame(t, crop=None):
    p=f"{OUT}/_f.png"
    subprocess.run(["ffmpeg","-v","error","-y","-ss",str(t),"-i",SRC,"-frames:v","1",p],check=True)
    im=Image.open(p).convert("RGB")
    if crop:
        x0,y0,w,h=crop; im=im.crop((x0,y0,x0+w,y0+h)).resize((W,H),Image.LANCZOS)
    return im

def gradient(im, y0, y1, amax):
    # колоколообразный мягкий градиент: плавно входит и плавно уходит, без жёстких краёв
    ov=Image.new("L",(W,H),0); d=ImageDraw.Draw(ov); mid=y0+(y1-y0)*0.55
    for y in range(y0,y1):
        k=(y-y0)/(y1-y0)
        a=amax*(k/0.4 if k<0.4 else (1.0 if k<0.62 else max(0,(1-k)/0.38)))
        d.line([(0,y),(W,y)],fill=int(a))
    ov=ov.filter(ImageFilter.GaussianBlur(24))
    dark=Image.new("RGB",(W,H),(10,8,7)); im.paste(dark,(0,0),ov); return im

def tw(d,txt,font,sp=0): 
    return d.textlength(txt,font=font)+sp*(len(txt)-1)
def text(im, txt, font, cx, y, fill, sp=0, shadow=True, anchor="c", x=None):
    lay=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    w=tw(d,txt,font,sp); x0=cx-w/2 if x is None else x
    def put(dr,dx,dy,col):
        if sp==0: dr.text((x0+dx,y+dy),txt,font=font,fill=col)
        else:
            xx=x0+dx
            for ch in txt: dr.text((xx,y+dy),ch,font=font,fill=col); xx+=dr.textlength(ch,font=font)+sp
    if shadow:
        sh=Image.new("RGBA",(W,H),(0,0,0,0)); ds=ImageDraw.Draw(sh); put(ds,0,4,(0,0,0,170))
        sh=sh.filter(ImageFilter.GaussianBlur(9)); im.paste(sh,(0,0),sh)
    put(d,0,0,fill+(255,)); im.paste(lay,(0,0),lay); return w

# --- эскиз 1: цитата, t=2.30 (на слове «стерва»)
def s1():
    im=frame(2.30); im=gradient(im,820,1560,185)
    cx=W//2
    text(im,"КОГДА ГОВОРЯТ",inter("SemiBold",34),cx,985,GOLD,sp=7)
    d=ImageDraw.Draw(im)
    # цитатная планка слева
    im_d=ImageDraw.Draw(im); im_d.rounded_rectangle((86,1052,92,1262),3,fill=GOLD)
    f=serif_i(84)
    text(im,"«Красивая женщина —",f,0,1050,SOFT,x=122)
    text(im,"это стерва, это дура»",f,0,1150,SOFT,x=122)
    return im
# --- эскиз 2: лента новостей, t=30.55 (перед прокруткой на «пролистываю»)
def s2():
    im=Image.new("RGB",(W,H),(14,11,9)); d=ImageDraw.Draw(im)
    for y in range(H): 
        k=y/H; d.line([(0,y),(W,y)],fill=(int(24-10*k),int(19-8*k),int(15-6*k)))
    feed=Image.new("RGBA",(W,H),(0,0,0,0)); fd=ImageDraw.Draw(feed)
    tags=[("СРОЧНО",(214,72,62)),("ШОК",(214,72,62)),("СКАНДАЛ",(214,72,62)),("СРОЧНО",(214,72,62))]
    y=-330
    for i in range(4):
        fd.rounded_rectangle((70,y,1010,y+520),44,fill=(34,28,22,255),outline=(62,52,40,255),width=2)
        fd.ellipse((106,y+34,166,y+94),fill=(86,72,56,255)); fd.rounded_rectangle((184,y+46,420,y+62),8,fill=(94,80,62,255)); fd.rounded_rectangle((184,y+72,330,y+84),6,fill=(66,56,44,255))
        fd.rounded_rectangle((106,y+120,974,y+330),26,fill=(52,43,34,255))
        fd.rounded_rectangle((106,y+352,860,y+380),12,fill=(150,132,104,255)); fd.rounded_rectangle((106,y+398,640,y+420),10,fill=(92,78,62,255))
        t,c=tags[i]; f=inter("Bold",26); w=fd.textlength(t,font=f)+sp if (sp:=0) else fd.textlength(t,font=f)
        fd.rounded_rectangle((126,y+142,126+w+36,y+190),14,fill=c+(255,)); fd.text((144,y+148),t,font=f,fill=(255,245,240,255))
        y+=560
    feed=feed.filter(ImageFilter.GaussianBlur(1.2)); im.paste(feed,(0,0),feed)
    im=gradient(im,860,1480,225)
    cx=W//2; f=inter("SemiBold",74)
    text(im,"Я просто их",f,cx,1060,IVORY); text(im,"пролистываю,",f,cx,1152,IVORY)
    return im
# --- эскиз 3: финал, крупный план t=42.90 (кроп 1.2x)
def s3():
    im=frame(42.90,crop=(90,213,900,1600)); im=gradient(im,840,1560,185)
    cx=W//2
    text(im,"Я уничтожаю",inter("SemiBold",86),cx,1040,IVORY)
    text(im,"на корню",inter("Bold",128),cx,1135,GOLD)
    return im

def safe(im):
    # зоны интерфейса Reels (справа кнопки, снизу подпись), для проверки
    o=im.copy().convert("RGBA"); ov=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(ov)
    d.rectangle((W-130,H-720,W,H),fill=(255,60,60,60)); d.rectangle((0,H-340,W,H),fill=(255,60,60,60)); d.rectangle((0,0,W,210),fill=(255,60,60,60))
    return Image.alpha_composite(o,ov).convert("RGB")

os.makedirs(OUT,exist_ok=True)
names=[("эскиз1_цитата_t0-2.30с.png",s1()),("эскиз2_лента_t30.55с.png",s2()),("эскиз3_финал_t42.90с.png",s3())]
for n,im in names: im.save(f"{OUT}/{n}")
# общий лист: 3 эскиза + зоны интерфейса (красным) для проверки
sheet=Image.new("RGB",(3*W//2+80,H//2+120),(18,18,18)); d=ImageDraw.Draw(sheet)
caps=["1 · 0:02.30 · начало, цитата","2 · 0:30.55 · лента новостей","3 · 0:42.90 · финал, крупный план"]
for i,(n,im) in enumerate(names):
    sheet.paste(safe(im).resize((W//2,H//2),Image.LANCZOS),(20+i*(W//2+20),90))
    d.text((20+i*(W//2+20),30),caps[i],font=inter("SemiBold",26),fill=(240,240,240))
sheet.save(f"{OUT}/эскизы_все.png")
os.remove(f"{OUT}/_f.png")
