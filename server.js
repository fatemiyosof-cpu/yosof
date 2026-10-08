const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.SUBSCRIPTION_ADMIN_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Subscription-Admin-Token');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

function loadStore(){ try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')||'{}')}catch{return {}} }
function saveStore(store){
  const tmp=DATA_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(store,null,2),'utf8');
  fs.renameSync(tmp,DATA_FILE);
}
function cleanText(v,fallback=''){return String(v ?? fallback).slice(0,500)}
function cleanConfig(c){
  return {
    name:cleanText(c.name,'Config'),
    country:cleanText(c.country,'Unknown'),
    countryCode:cleanText(c.countryCode,'XX').toUpperCase().slice(0,3),
    data:cleanText(c.data,'--'),
    days:cleanText(c.days,'--'),
    content:String(c.content||'').slice(0,30000),
    active:c.active!==false
  };
}
function requireAdmin(req,res,next){
  if(!ADMIN_TOKEN) return next();
  const supplied=req.get('X-Subscription-Admin-Token')||'';
  if(supplied!==ADMIN_TOKEN) return res.status(401).json({error:'admin_token_required'});
  next();
}
function publicUrl(req,id){
  const proto=req.get('x-forwarded-proto')||req.protocol;
  const host=req.get('x-forwarded-host')||req.get('host');
  return `${proto}://${host}/sub/${encodeURIComponent(id)}`;
}
function esc(x){return String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function safeFile(s){return String(s||'config').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,90)||'config'}
const flags={IR:'🇮🇷',TR:'🇹🇷',AE:'🇦🇪',DE:'🇩🇪',FR:'🇫🇷',US:'🇺🇸',GB:'🇬🇧',NL:'🇳🇱',FI:'🇫🇮',SE:'🇸🇪',RU:'🇷🇺',JP:'🇯🇵',KR:'🇰🇷',CA:'🇨🇦',SA:'🇸🇦',QA:'🇶🇦',IQ:'🇮🇶',AZ:'🇦🇿',AM:'🇦🇲',GE:'🇬🇪',BY:'🇧🇾'};

app.get('/health',(req,res)=>res.json({ok:true,service:'ARcodm Subscription',version:'2.0.0'}));

app.post('/api/subscriptions',requireAdmin,(req,res)=>{
  const body=req.body||{};
  const profile=cleanText(body.profile,'My-Config');
  const configs=Array.isArray(body.configs)?body.configs.map(cleanConfig).filter(c=>c.content):[];
  if(!configs.length) return res.status(400).json({error:'no_configs'});
  const id=crypto.randomBytes(9).toString('base64url');
  const store=loadStore();
  store[id]={
    id,
    panelName:cleanText(body.panelName,'PANEL'),
    profile,
    volume:cleanText(body.volume,configs[0].data||'--'),
    days:cleanText(body.days,configs[0].days||'--'),
    createdAt:new Date().toISOString(),
    configs,
    active:true
  };
  saveStore(store);
  res.json({ok:true,id,url:publicUrl(req,id)});
});


app.patch('/api/subscriptions/:id',(req,res)=>{
  const id=String(req.params.id||'');
  const store=loadStore(); const sub=store[id];
  if(!id||!sub) return res.status(404).json({error:'not_found'});
  const body=req.body||{};
  // IMPORTANT: this endpoint controls ONLY the Subscription itself.
  // Config content, generation, and per-config state are never changed here.
  if(typeof body.active==='boolean') sub.active=body.active;
  sub.updatedAt=new Date().toISOString(); saveStore(store);
  res.json({ok:true,id,active:sub.active!==false});
});

app.delete('/api/subscriptions/:id',(req,res)=>{
  const id=String(req.params.id||'');
  if(!id) return res.status(400).json({error:'missing_id'});
  const store=loadStore();
  if(!store[id]) return res.status(404).json({error:'not_found'});
  delete store[id];
  saveStore(store);
  res.json({ok:true,id,disabled:true});
});

app.get('/sub/:id',(req,res)=>{
  const sub=loadStore()[req.params.id];
  if(!sub) return res.status(404).send('Subscription not found');
  if(sub.active===false) return res.status(403).send('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subscription غیرفعال</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#050b11;color:#fff;font-family:Arial,sans-serif"><div style="text-align:center;padding:30px"><div style="font-size:54px">⛔</div><h2>Subscription غیرفعال است</h2><p style="color:#9fb2bd">این اشتراک در حال حاضر فعال نیست.</p></div></body></html>');

  const activeConfigs=sub.configs;
  if(!activeConfigs.length) return res.status(403).send('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subscription غیرفعال</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#050b11;color:#fff;font-family:Arial,sans-serif"><div style="text-align:center;padding:30px"><div style="font-size:54px">⛔</div><h2>Subscription غیرفعال است</h2><p style="color:#9fb2bd">تمام کانفیگ‌های این اشتراک غیرفعال هستند.</p></div></body></html>');
  const rows=activeConfigs.map((c,i)=>`
    <article class="loc" style="--i:${i}">
      <div class="loc-left">
        <div class="flag">${flags[c.countryCode]||'🌐'}</div>
        <div class="loc-info"><b>${esc(c.country)}</b><small>${esc(c.data)} · ${esc(c.days)}</small></div>
      </div>
      <a class="mini-btn" href="/sub/${encodeURIComponent(sub.id)}/config/${i}" download><span>دانلود</span><strong>.conf</strong></a>
    </article>`).join('');

  res.type('html').send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07131c">
<title>${esc(sub.profile)} · ARcodm</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lalezar&family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--cyan:#00e5ff;--blue:#4388ff;--ink:#eafcff;--muted:#8da7b4;--panel:rgba(9,20,31,.72);--line:rgba(0,229,255,.15)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;min-height:100vh;background:#030a10;color:var(--ink);font-family:Vazirmatn,system-ui,sans-serif;overflow-x:hidden}
body:before{content:"";position:fixed;inset:-20%;background:radial-gradient(circle at 15% 15%,rgba(0,229,255,.18),transparent 28%),radial-gradient(circle at 85% 25%,rgba(67,136,255,.16),transparent 30%),radial-gradient(circle at 50% 90%,rgba(0,180,255,.10),transparent 35%);filter:blur(25px);animation:aurora 11s ease-in-out infinite alternate;pointer-events:none}
.intro{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#02080e;overflow:hidden;animation:introOut .75s 1.65s cubic-bezier(.7,0,.2,1) forwards}
.intro:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 46%,rgba(0,229,255,.16),transparent 27%),linear-gradient(180deg,rgba(2,8,14,.1),rgba(2,8,14,.88));pointer-events:none}
.intro-glow{position:absolute;width:260px;height:260px;border-radius:50%;background:rgba(0,229,255,.12);filter:blur(45px);animation:introGlow 1.8s ease-in-out both}
.intro-logo{position:relative;z-index:2;width:86px;height:86px;border-radius:26px;display:grid;place-items:center;font:48px/1 Lalezar;color:#bfffff;background:linear-gradient(145deg,rgba(0,229,255,.18),rgba(67,136,255,.08));border:1px solid rgba(0,229,255,.42);box-shadow:0 0 0 9px rgba(0,229,255,.025),0 0 70px rgba(0,229,255,.24),inset 0 0 35px rgba(0,229,255,.12);opacity:0;transform:translateY(18px) scale(.78);animation:introLogo .75s .08s cubic-bezier(.2,.9,.2,1) forwards}
.intro-brand{position:relative;z-index:2;margin-top:16px;font:clamp(46px,13vw,72px)/1 Lalezar;background:linear-gradient(90deg,#fff,#73f5ff,#6a9dff,#fff);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;opacity:0;transform:translateY(14px);animation:introText .7s .42s cubic-bezier(.2,.9,.2,1) forwards,introShine 2.5s .7s linear infinite}
.intro-sub{position:relative;z-index:2;margin-top:7px;color:#71909d;font-size:10px;letter-spacing:4px;opacity:0;animation:introText .6s .7s ease forwards}
.intro-line{position:relative;z-index:2;width:120px;height:2px;margin-top:23px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;opacity:0;animation:introText .5s .82s ease forwards}
.intro-line span{display:block;width:42%;height:100%;border-radius:99px;background:linear-gradient(90deg,#00e5ff,#6b8fff);box-shadow:0 0 14px #00e5ff;animation:introProgress 1s .82s ease both}
@keyframes introLogo{to{opacity:1;transform:none}}@keyframes introText{to{opacity:1;transform:none}}@keyframes introGlow{0%{transform:scale(.5);opacity:.2}50%{transform:scale(1.15);opacity:.9}100%{transform:scale(1);opacity:.7}}@keyframes introProgress{from{transform:translateX(-130%)}to{transform:translateX(280%)}}@keyframes introShine{to{background-position:220% center}}@keyframes introOut{to{opacity:0;visibility:hidden;transform:scale(1.015);pointer-events:none}}
@media(max-width:560px){.intro-logo{width:78px;height:78px;border-radius:23px;font-size:44px}.intro-sub{letter-spacing:3px}.intro-line{width:105px}}
@media(prefers-reduced-motion:reduce){.intro{animation:introOut .2s .5s forwards}.intro-logo,.intro-brand,.intro-sub,.intro-line{animation:none!important;opacity:1;transform:none}.intro-line span{animation:none!important}}
.grid{position:fixed;inset:0;opacity:.13;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,black,transparent 85%);pointer-events:none}
.orb{position:fixed;border-radius:50%;filter:blur(2px);pointer-events:none;opacity:.5}.o1{width:190px;height:190px;background:rgba(0,229,255,.10);top:9%;left:-80px;animation:float1 9s ease-in-out infinite}.o2{width:240px;height:240px;background:rgba(67,136,255,.08);bottom:2%;right:-100px;animation:float2 12s ease-in-out infinite}
.wrap{width:min(760px,calc(100% - 26px));margin:0 auto;padding:30px 0 44px;position:relative}
.hero{position:relative;text-align:center;padding:20px 12px 24px;animation:rise .8s cubic-bezier(.2,.8,.2,1) both}
.logo{display:inline-flex;align-items:center;justify-content:center;width:78px;height:78px;border-radius:24px;background:linear-gradient(145deg,rgba(0,229,255,.18),rgba(67,136,255,.08));border:1px solid rgba(0,229,255,.32);box-shadow:0 0 0 7px rgba(0,229,255,.035),0 18px 55px rgba(0,229,255,.12),inset 0 0 28px rgba(0,229,255,.08);font:42px/1 Lalezar;color:#b9fbff;text-shadow:0 0 22px rgba(0,229,255,.7);animation:pulse 3s ease-in-out infinite}
.brand{font:clamp(35px,9vw,62px)/1 Lalezar;margin-top:13px;background:linear-gradient(90deg,#fff,#72f5ff,#6a9dff,#fff);background-size:250% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 5s linear infinite}
.subbrand{margin-top:7px;color:var(--muted);font-size:12px;letter-spacing:2px;text-transform:uppercase}
.card{position:relative;background:linear-gradient(145deg,rgba(13,28,41,.82),rgba(5,14,23,.72));border:1px solid var(--line);border-radius:30px;padding:23px;box-shadow:0 30px 90px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.035);backdrop-filter:blur(18px);animation:rise .9s .08s cubic-bezier(.2,.8,.2,1) both;overflow:hidden}
.card:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 30%,rgba(255,255,255,.045) 50%,transparent 70%);transform:translateX(120%);animation:sweep 7s ease-in-out infinite}
.topline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;position:relative}
.title-wrap{min-width:0}.eyebrow{font-size:11px;color:#73f3ff;font-weight:800;letter-spacing:1.5px}.title{font:clamp(24px,7vw,34px)/1.15 Lalezar;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.live{display:flex;align-items:center;gap:7px;padding:8px 11px;border-radius:999px;background:rgba(0,229,255,.07);border:1px solid rgba(0,229,255,.15);font-size:10px;color:#9cf8ff;font-weight:800;flex:none}.dot{width:7px;height:7px;border-radius:50%;background:#00f0c0;box-shadow:0 0 13px #00f0c0;animation:blink 1.6s infinite}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;position:relative}
.stat{padding:14px 10px;border:1px solid rgba(255,255,255,.065);background:rgba(255,255,255,.025);border-radius:18px;text-align:center;transition:.25s transform,.25s border-color,.25s background;animation:pop .6s calc(var(--i)*.08s + .2s) both}.stat:hover{transform:translateY(-3px);border-color:rgba(0,229,255,.28);background:rgba(0,229,255,.045)}
.stat-icon{font-size:19px}.stat b{display:block;margin-top:4px;font-size:13px}.stat small{display:block;color:var(--muted);font-size:9px;margin-top:2px}
.section-title{display:flex;align-items:center;gap:10px;margin:25px 2px 11px;font:21px Lalezar}.section-title:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,rgba(0,229,255,.22),transparent)}
.loc{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;margin-top:9px;border:1px solid rgba(255,255,255,.065);border-radius:19px;background:rgba(255,255,255,.025);transition:transform .25s,border-color .25s,background .25s;animation:slide .55s calc(var(--i)*.07s + .25s) both}.loc:hover{transform:translateX(-4px);border-color:rgba(0,229,255,.28);background:rgba(0,229,255,.045)}
.loc-left{display:flex;align-items:center;gap:11px;min-width:0}.flag{width:43px;height:43px;border-radius:14px;display:grid;place-items:center;background:rgba(0,229,255,.055);border:1px solid rgba(0,229,255,.11);font-size:24px;flex:none}.loc-info{min-width:0}.loc-info b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.loc-info small{display:block;color:var(--muted);font-size:10px;margin-top:3px}
.mini-btn{display:flex;align-items:center;gap:6px;text-decoration:none;color:#031015;background:linear-gradient(135deg,#8fffff,#37cfff);padding:10px 12px;border-radius:13px;font-size:10px;font-weight:900;box-shadow:0 8px 22px rgba(0,229,255,.13);transition:.22s transform,.22s box-shadow;flex:none}.mini-btn:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 12px 28px rgba(0,229,255,.22)}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;position:relative}.action{border:0;border-radius:17px;padding:14px 12px;font-family:inherit;font-weight:900;cursor:pointer;transition:.22s transform,.22s box-shadow}.action:hover{transform:translateY(-2px)}.primary{background:linear-gradient(135deg,#00e5ff,#4f8dff);color:#031015;box-shadow:0 14px 34px rgba(0,180,255,.18)}.secondary{background:rgba(255,255,255,.045);color:#d9faff;border:1px solid rgba(255,255,255,.08)!important}
.note{margin:16px 2px 0;color:#6f8793;font-size:10px;line-height:2;text-align:center}.creator-footer{text-align:center;margin-top:22px;padding:10px 0 4px}.powered-by{font:800 clamp(18px,5vw,24px)/1.1 system-ui,sans-serif;letter-spacing:.4px;animation:creatorFloat 3.4s ease-in-out infinite}.powered{color:#fff;text-shadow:0 0 7px rgba(255,255,255,.55),0 0 18px rgba(255,255,255,.28);background:linear-gradient(90deg,#fff,#fff,#d9faff,#fff);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:whiteShine 3s linear infinite}.yousef{color:#ff334f;text-shadow:0 0 7px rgba(255,51,79,.8),0 0 20px rgba(255,51,79,.42);animation:redPulse 1.8s ease-in-out infinite}.creator-caption{margin-top:5px;color:#58727e;font-size:8px;letter-spacing:2px;text-transform:uppercase}.creator-link{display:inline-flex;align-items:center;gap:7px;margin-top:9px;padding:7px 12px;border-radius:999px;text-decoration:none;color:#8eefff;background:rgba(0,229,255,.035);border:1px solid rgba(0,229,255,.13);font-size:9px;font-weight:800;transition:.22s transform,.22s border-color,.22s box-shadow}.creator-link:hover{transform:translateY(-2px);border-color:rgba(0,229,255,.32);box-shadow:0 8px 22px rgba(0,229,255,.12)}
@keyframes creatorFloat{50%{transform:translateY(-2px)}}@keyframes whiteShine{to{background-position:220% center}}@keyframes redPulse{0%,100%{text-shadow:0 0 7px rgba(255,51,79,.75),0 0 18px rgba(255,51,79,.36)}50%{text-shadow:0 0 10px rgba(255,51,79,1),0 0 28px rgba(255,51,79,.58)}}
.toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);opacity:0;pointer-events:none;background:rgba(5,18,28,.94);border:1px solid rgba(0,229,255,.22);color:#dffcff;padding:11px 16px;border-radius:14px;font-size:11px;font-weight:800;box-shadow:0 16px 45px rgba(0,0,0,.35);transition:.3s;z-index:10}.toast.show{opacity:1;transform:translate(-50%,0)}
@keyframes rise{from{opacity:0;transform:translateY(24px) scale(.985)}to{opacity:1;transform:none}}@keyframes pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}@keyframes slide{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}@keyframes shine{to{background-position:250% center}}@keyframes pulse{0%,100%{transform:translateY(0);box-shadow:0 0 0 7px rgba(0,229,255,.035),0 18px 55px rgba(0,229,255,.12),inset 0 0 28px rgba(0,229,255,.08)}50%{transform:translateY(-5px);box-shadow:0 0 0 10px rgba(0,229,255,.025),0 24px 70px rgba(0,229,255,.2),inset 0 0 34px rgba(0,229,255,.12)}}@keyframes aurora{to{transform:translate(5%,3%) scale(1.08)}}@keyframes float1{50%{transform:translate(80px,45px)}}@keyframes float2{50%{transform:translate(-70px,-35px)}}@keyframes sweep{0%,55%{transform:translateX(120%)}75%,100%{transform:translateX(-120%)}}@keyframes blink{50%{opacity:.35;box-shadow:0 0 5px #00f0c0}}
@media(max-width:560px){.wrap{padding-top:15px}.card{padding:17px;border-radius:24px}.stats{gap:7px}.stat{padding:11px 5px}.loc{padding:10px}.mini-btn{padding:9px 10px}.actions{grid-template-columns:1fr}.live{display:none}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
</style></head>
<body>
<div id="intro" class="intro" aria-hidden="true">
  <div class="intro-glow"></div>
  <div class="intro-logo">A</div>
  <div class="intro-brand">ARcodm</div>
  <div class="intro-sub">SUBSCRIPTION</div>
  <div class="intro-line"><span></span></div>
</div>
<div class="grid"></div><div class="orb o1"></div><div class="orb o2"></div>
<main class="wrap">
<header class="hero"><div class="logo">A</div><div class="brand">ARcodm</div><div class="subbrand">Premium Subscription</div></header>
<section class="card">
<div class="topline"><div class="title-wrap"><div class="eyebrow">${esc(sub.panelName)} · SUBSCRIPTION</div><div class="title">${esc(sub.profile)}</div></div><div class="live"><i class="dot"></i>${sub.active===false?'غیرفعال':'فعال'}</div></div>
<div class="stats">
<div class="stat" style="--i:0"><div class="stat-icon">💾</div><b>${esc(sub.volume)}</b><small>حجم</small></div>
<div class="stat" style="--i:1"><div class="stat-icon">⏱️</div><b>${esc(sub.days)}</b><small>اعتبار</small></div>
<div class="stat" style="--i:2"><div class="stat-icon">🌍</div><b>${activeConfigs.length}</b><small>لوکیشن فعال</small></div>
</div>
<div class="section-title">لوکیشن‌ها</div>
<div>${rows}</div>
<div class="actions">
<button class="action primary" onclick="downloadZip()">📦 دانلود همه کانفیگ‌ها</button>
<button class="action secondary" onclick="copyLink()">🔗 کپی لینک Subscription</button>
</div>
<p class="note">این اشتراک اطلاعات ثابت دارد؛ باز کردن لینک باعث کم شدن حجم یا زمان نمی‌شود.</p>
</section>
<div class="creator-footer">
  <div class="powered-by"><span class="powered">Powered by</span> <span class="yousef">YOSOF</span></div>
  <div class="creator-caption">ARcodm Creator</div>
  <a class="creator-link" href="https://t.me/ar8codm" target="_blank" rel="noopener noreferrer"><span>✦</span> View Creator Channel <span>↗</span></a>
</div>
</main>
<div class="toast" id="toast"></div>
<script>
(function(){
  const intro=document.getElementById('intro');
  if(!intro)return;
  const finish=()=>{intro.style.pointerEvents='none';};
  setTimeout(finish,2500);
  intro.addEventListener('click',finish,{once:true});
})();
function toast(t){const e=document.getElementById('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1800)}
async function copyLink(){try{await navigator.clipboard.writeText(location.href);toast('لینک Subscription کپی شد ✓')}catch{toast('کپی لینک انجام نشد')}}
function downloadZip(){location.href='/sub/${encodeURIComponent(sub.id)}/zip';toast('در حال آماده‌سازی ZIP...')}
</script>
</body></html>`);
});

app.get('/sub/:id/config/:index',(req,res)=>{
  const sub=loadStore()[req.params.id], index=Number(req.params.index);
  if(!sub||sub.active===false||!Number.isInteger(index)||!sub.configs[index]) return res.status(404).send('Config not found');
  const c=sub.configs[index];
  res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Disposition',`attachment; filename="${safeFile(c.countryCode+'_'+c.name)}.conf"`);
  res.send(c.content);
});

app.get('/sub/:id/zip',(req,res)=>{
  const sub=loadStore()[req.params.id];
  if(!sub || sub.active===false) return res.status(404).send('Subscription not found');
  const activeConfigs=sub.configs;
  if(!activeConfigs.length) return res.status(404).send('Subscription disabled');
  const filename=safeFile((sub.profile||'ARcodm')+'_configs')+'.zip';
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  const archive=archiver('zip',{zlib:{level:6}});
  archive.on('error',err=>{if(!res.headersSent)res.status(500);res.end()});
  archive.pipe(res);
  const used=new Set();
  activeConfigs.forEach((c,i)=>{
    let base=safeFile((c.countryCode||'XX')+'_'+(c.name||('config_'+i+1)))||('config_'+i+1);
    let name=base+'.conf', n=2;
    while(used.has(name)){name=base+'_'+n+'.conf';n++}
    used.add(name); archive.append(c.content,{name});
  });
  archive.finalize();
});

app.get('/sub/:id/data.json',(req,res)=>{
  const sub=loadStore()[req.params.id];
  if(!sub) return res.status(404).json({error:'not_found'});
  res.json({id:sub.id,active:sub.active!==false,panelName:sub.panelName,profile:sub.profile,volume:sub.volume,days:sub.days,configs:sub.configs.map((c,i)=>({index:i,name:c.name,country:c.country,countryCode:c.countryCode,data:c.data,days:c.days,url:`/sub/${encodeURIComponent(sub.id)}/config/${i}`}))});
});

app.listen(PORT,()=>console.log(`ARcodm Subscription server listening on ${PORT}`));
