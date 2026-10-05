import base64, json, sys, subprocess, struct, random, math, os, wave
import numpy as np
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
FPS = 30

PALETTE = ['#3d6bff', '#ffc21a', '#22c55e', '#e040c8', '#ff8a1f', '#22d3c5', '#ff3048', '#9b5cff']
NAMES = dict(fr='France', de='Germany', es='Spain', pt='Portugal', be='Belgium', it='Italy', gb='UK', ma='Morocco',
             br='Brazil', ar='Argentina', us='USA', mx='Mexico', jp='Japan', dz='Algeria', tn='Tunisia', sn='Senegal',
             tr='Türkiye', ci='Ivory Coast', nl='Netherlands', pl='Poland', ch='Switzerland', kr='South Korea')
ROSTERS = {  # 8 countries per video, placed clockwise from the top-left
 'europe':   ['fr', 'de', 'es', 'pt', 'be', 'it', 'gb', 'ma'],
 'monde':    ['fr', 'br', 'es', 'jp', 'mx', 'ar', 'us', 'kr'],
 'afrique':  ['fr', 'dz', 'es', 'tn', 'sn', 'it', 'ma', 'ci'],
}
TEXT = dict(title='WHO WILL WIN?', comment='COMMENT YOUR COUNTRY', out='{} OUT', four='FINAL FOUR', three='FINAL THREE',
            final='FINAL', wins='{} WINS!', left='{} LEFT', champion='CHAMPION', slow='SLOW MOTION')
PARAMS = dict(strings=110, gain=[16, 38], spread=0.22, cutReach=0.9, speed=175, slowFactor=0.45, holdEnd=3.5)

def build_html(seed, roster, slow_at=None):
    cs = []
    for code, color in zip(ROSTERS[roster], PALETTE):
        name = NAMES[code]
        svg = open(f'{HERE}/package/flags/4x3/{code}.svg','rb').read()
        cs.append(dict(code=code, name=name, color=color, flag='data:image/svg+xml;base64,'+base64.b64encode(svg).decode()))
    cfg = dict(seed=seed, countries=cs, t=TEXT, slowAt=slow_at or [], **PARAMS)
    font = base64.b64encode(open(f'{HERE}/montserrat900.woff2','rb').read()).decode()
    font8 = base64.b64encode(open(f'{HERE}/montserrat800.woff2','rb').read()).decode()
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:Montserrat;font-weight:900;src:url(data:font/woff2;base64,{font}) format("woff2")}}
@font-face{{font-family:Montserrat;font-weight:800;src:url(data:font/woff2;base64,{font8}) format("woff2")}}
html,body{{margin:0;background:#000}}</style></head><body><canvas id="c"></canvas>
<script>window.BB_CFG={json.dumps(cfg)};</script><script>{open(HERE+"/game.js").read()}</script></body></html>'''

# ---------- audio ----------
SR = 44100
def tone_hit(v, rnd):
    d = 0.09; t = np.arange(int(SR*d))/SR
    f = rnd.uniform(700, 1150)
    s = np.sin(2*np.pi*f*t)*np.exp(-t*45) + 0.5*np.sin(2*np.pi*f*2.01*t)*np.exp(-t*70)
    s += np.random.default_rng(rnd.randint(0,1<<30)).normal(0, 1, len(t))*np.exp(-t*160)*0.25
    return s*(0.22+0.2*v)
def tone_die(rnd):
    d = 0.45; t = np.arange(int(SR*d))/SR
    f = 620*np.exp(-t*5)+90
    ph = 2*np.pi*np.cumsum(f)/SR
    s = np.sin(ph)*np.exp(-t*7) + 0.6*np.sin(ph*1.5)*np.exp(-t*9)
    s += np.random.default_rng(rnd.randint(0,1<<30)).normal(0,1,len(t))*np.exp(-t*25)*0.35
    return s*0.6
def tone_win():
    out = np.zeros(int(SR*2.2))
    for i, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        d = 1.6; t = np.arange(int(SR*d))/SR
        s = (np.sin(2*np.pi*f*t)+0.3*np.sin(2*np.pi*2*f*t))*np.exp(-t*2.2)*0.35
        o = int(i*0.12*SR); out[o:o+len(s)] += s
    return out
def render_audio(events, nframes, path, seed):
    rnd = random.Random(seed)
    buf = np.zeros(int(SR*nframes/FPS)+SR*3)
    last_hit = -99
    for e in events:
        o = int(e['f']/FPS*SR)
        if e['type']=='hit':
            if e['f'] - last_hit < 2: continue
            last_hit = e['f']; s = tone_hit(e['v'], rnd)
        elif e['type']=='die': s = tone_die(rnd)
        else: s = tone_win()
        buf[o:o+len(s)] += s
    buf = buf[:int(SR*nframes/FPS)]
    buf = np.tanh(buf*1.2)*0.85
    pcm = (buf*32767).astype('<i2')
    with wave.open(path,'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def make(seed, roster, out, preview_only=False):
    html = f'{HERE}/run_{roster}_{seed}.html'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CH)
        pg = b.new_page(viewport={'width':1080,'height':1920})
        # pass 1: find kill moments (sim is step-deterministic, slow-mo doesn't change it)
        open(html,'w').write(build_html(seed, roster))
        pg.goto('file://'+html); pg.evaluate('BB.init()')
        k = 0
        while not pg.evaluate('BB.frame(false)')['done'] and k < FPS*240: k += 1
        slow_at = pg.evaluate('BB.killSteps()')
        open(html,'w').write(build_html(seed, roster, slow_at))
        pg.goto('file://'+html); pg.evaluate('BB.init()')
        if preview_only:
            n = 0
            while True:
                r = pg.evaluate('BB.frame(false)'); n += 1
                if r['done'] or n > FPS*180: break
            ev = pg.evaluate('BB.events()'); sm = pg.evaluate('BB.summary()')
            deaths = [round(e['f']/FPS,1) for e in ev if e['type']=='die']
            print(f'{roster} seed {seed}: {n/FPS:.1f}s deaths {deaths} winner {sm["winner"]}')
            b.close(); return
        vid = out.replace('.mp4','_v.mp4')
        ff = subprocess.Popen(['ffmpeg','-v','error','-y','-f','image2pipe','-framerate',str(FPS),'-c:v','mjpeg','-i','-',
                               '-c:v','libx264','-pix_fmt','yuv420p','-crf','24','-preset','slow',vid], stdin=subprocess.PIPE)
        n = 0
        while True:
            r = pg.evaluate('BB.frame(true)')
            data = pg.evaluate('BB.shot()')
            ff.stdin.write(base64.b64decode(data.split(',',1)[1])); n += 1
            if n == 60: open(out.replace('.mp4','_frame.jpg'),'wb').write(base64.b64decode(data.split(',',1)[1]))
            if r['done'] or n > FPS*180: break
        ff.stdin.close(); ff.wait()
        ev = pg.evaluate('BB.events()')
        b.close()
    wav = out.replace('.mp4','.wav')
    render_audio(ev, n, wav, seed)
    subprocess.run(['ffmpeg','-v','error','-y','-i',vid,'-i',wav,'-c:v','copy','-c:a','aac','-b:a','160k','-shortest',out], check=True)
    os.remove(vid); os.remove(wav)
    print('wrote', out, f'{n/FPS:.1f}s')

if __name__ == '__main__':
    mode, roster = sys.argv[1], sys.argv[2]
    for s in [int(x) for x in sys.argv[3:]]:
        make(s, roster, f'{HERE}/battle_{roster}_{s}.mp4', preview_only=(mode=='sim'))
