# Финальный слой субтитров (стиль первого пробного монтажа). Время — секунды исходника.
# anim: rise | mask | pop | left | right | blur | words — у каждой фразы своё появление.
# Начала фраз сверены по огибающей голоса (±0,05 с).
def S(text,t=None,bold=False,size=None,color=None): return dict(text=text,t=t,bold=bold,size=size,color=color)
SUBS=[
 dict(t0=0.88,t1=3.62,style="q",label_t=0.20,label="КОГДА ГОВОРЯТ",
      lines=[[S("«Красивая женщина —",t=0.88)],[S("это стерва, это дура»",t=1.76)]]),
 dict(t0=3.68,t1=4.54,anim="left", lines=["и так далее"]),
 dict(t0=4.58,t1=5.84,anim="pop",  lines=["это не так"],bold=True),
 dict(t0=5.92,t1=6.90,anim="rise", lines=["Красивая женщина —"]),
 dict(t0=6.94,t1=7.76,anim="right",lines=["это прежде всего"]),
 dict(t0=7.78,t1=9.62,anim="mask", lines=["не обиженная Богом"]),
 dict(t0=9.74,t1=11.00,anim="pop", lines=["женщина, да?"]),
 dict(t0=11.30,t1=12.10,anim="left",lines=["Это женщина,"]),
 dict(t0=11.95,t1=14.30,style="g",anim="blur",lines=["сияющая изнутри"]),
 dict(t0=15.80,t1=17.25,anim="words",lines=["и извергающая","из себя"]),
 dict(t0=17.00,t1=18.90,anim="mask", lines=["только самое","положительное."]),
 dict(t0=18.84,t1=19.70,anim="right",lines=["Ну, по крайней мере,"]),
 dict(t0=19.72,t1=21.10,anim="rise", lines=["я так о себе думаю."]),
 dict(t0=21.24,t1=22.80,anim="words",lines=["Я не люблю","разговоры"]),
 dict(t0=23.36,t1=25.50,anim="left", lines=["плохие или","негативные."]),
 dict(t0=25.58,t1=26.78,anim="pop", lines=["Я встаю и ухожу,"],exit_word="ухожу,",exit_t=26.45),
 dict(t0=26.80,t1=28.45,anim="rise", lines=["потому что я не хочу","это слышать."]),
 dict(t0=28.56,t1=30.03,anim="mask", lines=["Я не смотрю","негативные новости."]),
 dict(t0=30.05,t1=31.36,anim="words",lines=["Я просто их","пролистываю,"]),
 dict(t0=31.38,t1=34.12,anim="blur", lines=["потому что я не хочу","себя наполнять этим."]),
 dict(t0=34.40,t1=35.46,anim="right",lines=["Я не хочу","сплетничать"]),
 dict(t0=35.49,t1=36.74,anim="words",lines=["и никогда не","сплетничаю,"]),
 dict(t0=36.76,t1=39.17,anim="mask", lines=["потому что меня это","загрязняет изнутри."]),
 dict(t0=39.20,t1=41.86,anim="left", lines=["И всё, что загрязняет","меня изнутри,"]),
 dict(t0=41.90,t1=43.54,style="f",
      lines=[[S("Я уничтожаю",t=41.90,size=86)],[S("на корню",t=42.94,bold=True,size=128,color=(236,200,124))]]),
]
