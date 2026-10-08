const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const TELEGRAM_URL = process.env.TELEGRAM_URL || 'https://t.me/ar8codm';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.PERSISTENT_DATA_DIR || '/var/data';
const FILE_DB = path.join(DATA_DIR, 'subscriptions.json');

app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

let pool = null;
let fileMode = false;
let fileStore = new Map();

function makeId() {
  return crypto.randomBytes(18).toString('base64url');
}
function now() { return new Date(); }
function iso(d) { return new Date(d).toISOString(); }
function normalizeDays(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}
function normalizeConfigs(configs) {
  if (!Array.isArray(configs)) return [];
  return configs.slice(0, 100).map((c, i) => ({
    name: String(c?.name || `Config ${i + 1}`).slice(0, 120),
    country: String(c?.country || 'Unknown').slice(0, 80),
    countryCode: String(c?.countryCode || 'XX').slice(0, 8),
    data: String(c?.data || '').slice(0, 40),
    days: normalizeDays(c?.days),
    content: String(c?.content || '').slice(0, 200000)
  })).filter(c => c.content);
}
function getDays(configs, fallback) {
  const values = (Array.isArray(configs) ? configs : []).map(c => normalizeDays(c.days));
  return Math.max(...values, normalizeDays(fallback));
}
function calcExpiryFrom(created, days) {
  return new Date(new Date(created).getTime() + days * 86400000);
}
function publicUrl(req, id) {
  const configured = BASE_URL;
  if (configured) return `${configured}/sub/${encodeURIComponent(id)}`;
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}/sub/${encodeURIComponent(id)}`;
  }
  return `/sub/${encodeURIComponent(id)}`;
}
function safeJson(v) { return JSON.stringify(v ?? {}); }

async function initStorage() {
  if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }, max: 5 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        panel_name TEXT NOT NULL DEFAULT '',
        profile TEXT NOT NULL DEFAULT '',
        volume TEXT NOT NULL DEFAULT '',
        days INTEGER NOT NULL DEFAULT 30,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        configs JSONB NOT NULL DEFAULT '[]'::jsonb
      );
      CREATE INDEX IF NOT EXISTS subscriptions_expires_idx ON subscriptions(expires_at);
      CREATE INDEX IF NOT EXISTS subscriptions_enabled_idx ON subscriptions(enabled);
    `);
    console.log('Storage: PostgreSQL');
    return;
  }
  fileMode = true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = fs.existsSync(FILE_DB) ? fs.readFileSync(FILE_DB, 'utf8') : '{}';
    const obj = JSON.parse(raw || '{}');
    fileStore = new Map(Object.entries(obj));
  } catch { fileStore = new Map(); }
  await persistFile();
  console.warn(`Storage: JSON file at ${FILE_DB}. On Render Free services this filesystem is ephemeral; set DATABASE_URL to use durable PostgreSQL.`);
}
async function persistFile() {
  if (!fileMode) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const obj = Object.fromEntries(fileStore);
  const tmp = FILE_DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, FILE_DB);
}

async function getSub(id) {
  if (pool) {
    const r = await pool.query('SELECT * FROM subscriptions WHERE id=$1 LIMIT 1', [id]);
    return r.rows[0] || null;
  }
  return fileStore.get(id) || null;
}
async function saveSub(sub) {
  if (pool) {
    await pool.query(`
      INSERT INTO subscriptions(id,panel_name,profile,volume,days,created_at,updated_at,expires_at,enabled,configs)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT(id) DO UPDATE SET
        panel_name=EXCLUDED.panel_name, profile=EXCLUDED.profile, volume=EXCLUDED.volume,
        days=EXCLUDED.days, updated_at=EXCLUDED.updated_at, expires_at=EXCLUDED.expires_at,
        enabled=EXCLUDED.enabled, configs=EXCLUDED.configs
    `, [sub.id, sub.panel_name, sub.profile, sub.volume, sub.days, sub.created_at, sub.updated_at, sub.expires_at, sub.enabled, safeJson(sub.configs)]);
  } else {
    fileStore.set(sub.id, sub);
    await persistFile();
  }
  return sub;
}
async function disableSub(id) {
  if (pool) {
    await pool.query('UPDATE subscriptions SET enabled=false, updated_at=NOW() WHERE id=$1', [id]);
  } else {
    const s = fileStore.get(id); if (s) { s.enabled = false; s.updated_at = iso(now()); fileStore.set(id, s); await persistFile(); }
  }
}
function isValidSub(s) {
  return s && s.enabled !== false && new Date(s.expires_at).getTime() > Date.now() && Array.isArray(s.configs) && s.configs.length;
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();
  const key = req.get('x-admin-key') || req.query.key || '';
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', async (_req, res) => {
  let db = 'file';
  if (pool) {
    try { await pool.query('SELECT 1'); db = 'postgres'; } catch { db = 'postgres-error'; }
  }
  res.json({ ok: db !== 'postgres-error', service: 'ARcodm Subscription', version: '3.1.0', storage: db, time: iso(now()) });
});

app.post('/api/subscriptions', async (req, res) => {
  try {
    const b = req.body || {};
    const configs = normalizeConfigs(b.configs);
    if (!configs.length) return res.status(400).json({ error: 'configs_required' });
    const requestedId = String(b.subscriptionId || '').trim();
    let id = requestedId && /^[A-Za-z0-9_-]{10,100}$/.test(requestedId) ? requestedId : makeId();
    const old = await getSub(id);
    const requestedDays = getDays(configs, b.days);
    const oldExpiryMs = old?.expires_at ? new Date(old.expires_at).getTime() : 0;
    const oldIsActive = Number.isFinite(oldExpiryMs) && oldExpiryMs > Date.now();
    // Updating an active subscription must NOT reset its timer.
    // Once it has expired (or doesn't exist), a fresh timer starts.
    const created = oldIsActive && old?.created_at ? new Date(old.created_at) : now();
    const expiresAt = oldIsActive ? new Date(oldExpiryMs) : calcExpiryFrom(created, requestedDays);
    const days = oldIsActive ? Math.max(1, Math.ceil((oldExpiryMs - new Date(created).getTime()) / 86400000)) : requestedDays;
    const sub = {
      id,
      panel_name: String(b.panelName || '').slice(0, 120),
      profile: String(b.profile || b.panelName || '').slice(0, 120),
      volume: String(b.volume || configs[0]?.data || '').slice(0, 40),
      days,
      created_at: iso(created),
      updated_at: iso(now()),
      expires_at: iso(expiresAt),
      enabled: true,
      configs
    };
    await saveSub(sub);
    res.json({ ok: true, id, url: publicUrl(req, id), expiresAt: sub.expires_at, updated: !!old });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'subscription_create_failed' });
  }
});

app.delete('/api/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'id_required' });
    await disableSub(id);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'subscription_delete_failed' }); }
});

app.get('/api/subscriptions/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const s = await getSub(String(req.params.id || ''));
    if (!isValidSub(s)) return res.status(404).json({ error: 'subscription_not_found' });
    res.json({ ok: true, id: s.id, panelName: s.panel_name, profile: s.profile, volume: s.volume, days: s.days, createdAt: s.created_at, expiresAt: s.expires_at, configs: s.configs });
  } catch (e) { console.error(e); res.status(500).json({ error: 'subscription_read_failed' }); }
});

function esc(s) {
  return String(s ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function page(req, s, id) {
  const expires = new Date(s.expires_at).toISOString();
  const totalGB = (() => {
    const m = String(s.volume || '').match(/([\d.]+)/); return m ? m[1] : (s.configs[0]?.data || '--');
  })();
  const subUrl = publicUrl(req, id);
  const configs = s.configs.map((c, i) => `<article class="cfg" style="--d:${i * 55}ms">
    <div class="flag">${esc(c.countryCode || '🌐')}</div>
    <div class="cfgmain"><b>${esc(c.country)}</b><span>${esc(c.data || totalGB)} · ${esc(c.days)} روز</span></div>
    <button class="dl" onclick="downloadOne(${i})"><span>دانلود</span><b>.conf</b></button>
  </article>`).join('');
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#04111a"><title>${esc(s.panel_name || 'ARcodm')} · Subscription</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
  :root{--cyan:#58eaff;--blue:#4c9fff;--purple:#8b72ff;--bg:#02080f;--card:#071720;--line:#123646;--muted:#86a2b0}
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Vazirmatn,system-ui,sans-serif;background:var(--bg);color:#ecfbff}body{overflow-x:hidden}
  body:before{content:"";position:fixed;inset:0;z-index:-3;background:radial-gradient(circle at 15% 5%,#063d50 0,transparent 35%),radial-gradient(circle at 90% 20%,#17245b 0,transparent 32%),linear-gradient(180deg,#02080f,#041018 70%,#02080f)}
  body:after{content:"";position:fixed;inset:-20%;z-index:-2;background:conic-gradient(from 220deg,transparent,#00dfff18,#7c5cff18,transparent 55%);filter:blur(70px);animation:aurora 16s linear infinite}
  .wrap{width:min(720px,92vw);margin:auto;padding:22px 0 58px}.brand{text-align:center}.brand .mini{font-size:10px;letter-spacing:4px;color:#7895a4;font-weight:800}.brand h1{margin:5px 0 2px;font-size:clamp(42px,11vw,70px);line-height:1;background:linear-gradient(90deg,#fff,var(--cyan),#91b7ff,#fff);-webkit-background-clip:text;color:transparent;background-size:250% 100%;animation:shine 5s ease infinite}.brand p{margin:8px 0 0;color:var(--cyan);font-size:13px;font-weight:900;letter-spacing:2px}
  .hero{margin-top:22px;padding:18px;border:1px solid #123d4e;border-radius:30px;background:linear-gradient(145deg,#081d28ee,#041019ee);box-shadow:0 25px 80px #0009,inset 0 0 40px #00d9ff09;backdrop-filter:blur(18px)}
  .timerBox{display:grid;place-items:center;padding:8px 0 14px}.timer{position:relative;width:min(250px,70vw);aspect-ratio:1}.timer svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}.track{fill:none;stroke:#163645;stroke-width:9}.prog{fill:none;stroke:url(#g);stroke-width:9;stroke-linecap:round;filter:drop-shadow(0 0 9px #00d9ff);transition:stroke-dashoffset .7s}.timeCenter{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;padding:22px}.dayCount{font-size:clamp(18px,5vw,26px);font-weight:900;line-height:1;color:#eefcff;background:linear-gradient(135deg,#12384a,#0b2430);border:1px solid #1d586b;border-radius:999px;padding:7px 14px;box-shadow:0 6px 20px #00d9ff10}.time{font-size:clamp(24px,7vw,40px);font-weight:900;direction:ltr;letter-spacing:.5px;line-height:1.05;white-space:nowrap}.timeLabel{font-size:11px;color:#73dcef;font-weight:700}.title{text-align:center;font-size:22px;font-weight:900;margin:4px 0 14px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.stat{padding:13px 6px;border:1px solid #153b4a;border-radius:17px;background:#07151e;text-align:center}.stat b{display:block;font-size:20px;line-height:1.3}.stat span{display:block;color:#7893a0;font-size:10px;margin-top:4px}
  .section{margin-top:20px}.sectionTitle{display:flex;align-items:center;justify-content:space-between;margin:0 3px 10px}.sectionTitle h2{margin:0;font-size:17px}.sectionTitle span{font-size:10px;color:#7893a0}.cfgs{display:grid;gap:8px}.cfg{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid #123746;border-radius:18px;background:linear-gradient(90deg,#071722,#081d27);animation:up .45s var(--d) ease both}.flag{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#06131c;border:1px solid #174658;font-size:17px;flex:0 0 auto}.cfgmain{flex:1;min-width:0}.cfgmain b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cfgmain span{display:block;color:#7893a0;font-size:9px;margin-top:3px}.dl{border:0;border-radius:12px;padding:9px 10px;font:inherit;font-size:10px;font-weight:900;cursor:pointer;color:#031019;background:linear-gradient(135deg,#65edff,#519eff);white-space:nowrap}.dl b{font-size:9px;opacity:.7}
  .mainbtn,.copy{width:100%;border:0;border-radius:15px;padding:14px;margin-top:10px;font:inherit;font-size:13px;font-weight:900;cursor:pointer}.mainbtn{color:#031019;background:linear-gradient(135deg,#63edff,#4d9dff);box-shadow:0 9px 24px #00cfff20}.copy{margin-top:8px;color:#bcefff;background:#061720;border:1px solid #16495c}
  .linkBox{margin-top:12px;padding:11px;border:1px solid #16485a;border-radius:17px;background:#06141d}.linkLabel{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:9px;color:#7f9ca8;font-weight:700}.linkInput{width:100%;min-height:43px;border:1px solid #173e4e;border-radius:11px;background:#031018;color:#bff4ff;padding:9px 10px;font:500 10px system-ui,sans-serif;direction:ltr;text-align:left;outline:none}.linkActions{display:grid;grid-template-columns:1fr 48px;gap:7px;margin-top:7px}.linkActions button{border:0;border-radius:11px;min-height:43px;font:inherit;font-weight:900;cursor:pointer}.copyFull{background:linear-gradient(135deg,#0aaebf,#1678dc);color:#fff}.openLink{background:#0a202b;color:#86eaff;border:1px solid #17495c!important}
  .foot{text-align:center;margin-top:18px;color:#627d89;font-size:10px}.tg{display:inline-block;margin-top:7px;color:#69eaff;text-decoration:none;font-weight:800}
  .toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%) translateY(15px);opacity:0;padding:10px 14px;border-radius:12px;background:#071a23;border:1px solid #216077;color:#d9fbff;font-size:11px;transition:.22s;z-index:10;white-space:nowrap}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  @keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes shine{0%,100%{background-position:0%}50%{background-position:100%}}@keyframes aurora{to{transform:rotate(360deg)}}
  @media(max-width:560px){.wrap{padding-top:15px}.hero{padding:13px;border-radius:25px}.stats{gap:6px}.stat{padding:11px 4px}.stat b{font-size:18px}.cfg{padding:9px;border-radius:16px}.flag{width:38px;height:38px}.dl{padding:8px 9px}.linkInput{font-size:9px}}
  </style></head><body><main class="wrap">
  <header class="brand"><div class="mini">POWERED BY YOSOF</div><h1>ARcodm</h1><p>SUBSCRIPTION CENTER</p></header>
  <section class="hero"><div class="timerBox"><div class="timer"><svg viewBox="0 0 220 220"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#52f3ff"/><stop offset=".5" stop-color="#459cff"/><stop offset="1" stop-color="#9a6cff"/></linearGradient></defs><circle class="track" cx="110" cy="110" r="96"/><circle id="prog" class="prog" cx="110" cy="110" r="96"/></svg><div class="timeCenter"><div id="dayCount" class="dayCount">-- روز</div><div id="time" class="time">--:--:--</div><div class="timeLabel">زمان باقی‌مانده</div></div></div></div>
    <div class="title">${esc(s.panel_name || s.profile || 'My-Config')}</div><div class="stats"><div class="stat"><b>${s.configs.length}</b><span>لوکیشن فعال</span></div><div class="stat"><b>${esc(totalGB)} GB</b><span>حجم</span></div><div class="stat"><b>${esc(s.days)}</b><span>روز</span></div></div>
    <div class="section"><div class="sectionTitle"><h2>🌍 لوکیشن‌ها</h2><span>${s.configs.length} کانفیگ</span></div><div class="cfgs">${configs}</div><button class="mainbtn" onclick="downloadAll()">📦 دانلود همه کانفیگ‌ها</button>
      <div class="linkBox"><div class="linkLabel"><span>🔗 لینک کامل Subscription</span><span>آماده کپی</span></div><input id="subInput" class="linkInput" readonly value="${esc(subUrl)}"><div class="linkActions"><button class="copyFull" onclick="copySub()">کپی لینک کامل</button><button class="openLink" onclick="openSub()">↗</button></div></div>
    </div>
  </section><footer class="foot">ARcodm Creator · Powered by Yosof<br><a class="tg" href="${esc(TELEGRAM_URL)}" target="_blank" rel="noopener">↗ View Creator Channel</a></footer></main><div id="toast" class="toast"></div>
  <script>
  const DATA=${safeJson(s.configs)}; const EXP=${JSON.stringify(expires)}; const SUB=${JSON.stringify(subUrl)}; const R=96*2*Math.PI; const prog=document.getElementById('prog'); prog.style.strokeDasharray=R;
  function tick(){const ms=Math.max(0,new Date(EXP)-Date.now());const sec=Math.floor(ms/1000),d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60;document.getElementById('dayCount').textContent=d+' روز';document.getElementById('time').textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');const total=${Math.max(1,s.days)}*86400000;prog.style.strokeDashoffset=R*(1-Math.min(1,ms/total));if(ms<=0)document.title='Subscription Expired · ARcodm'} tick();setInterval(tick,1000);
  function toast(t){const x=document.getElementById('toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),1800)}
  function blobDownload(name,content){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));a.download=name.replace(/[^a-zA-Z0-9._-]/g,'_')+'.conf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function downloadOne(i){const c=DATA[i];blobDownload(c.name||('config-'+(i+1)),c.content);toast('دانلود شروع شد ✓')}
  function downloadAll(){DATA.forEach((c,i)=>setTimeout(()=>downloadOne(i),i*180));toast('دانلود همه کانفیگ‌ها شروع شد ✓')}
  async function copySub(){const value=SUB||location.href;try{await navigator.clipboard.writeText(value);toast('لینک کامل Subscription کپی شد ✓')}catch{const x=document.getElementById('subInput');x.focus();x.select();document.execCommand('copy');toast('لینک کامل انتخاب و کپی شد ✓')}}
  function openSub(){window.open(SUB||location.href,'_blank','noopener,noreferrer')}
  </script></body></html>`;
}

app.get('/sub/:id', async (req, res) => {
  try {
    const s = await getSub(String(req.params.id || ''));
    if (!isValidSub(s)) return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Subscription Not Found</title><style>body{font-family:system-ui;background:#02070e;color:#fff;display:grid;place-items:center;min-height:100vh}main{text-align:center}h1{font-size:42px}p{color:#8ba0ad}</style><main><h1>Subscription Not Found</h1><p>این Subscription وجود ندارد یا منقضی شده است.</p></main>');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(page(req, s, req.params.id));
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
});

app.get('/', (_req, res) => res.send('<!doctype html><meta charset="utf-8"><title>ARcodm Subscription API</title><style>body{font-family:system-ui;background:#02070e;color:#fff;display:grid;place-items:center;min-height:100vh}main{max-width:650px;padding:30px;text-align:center}code{color:#65eaff}</style><main><h1>ARcodm Subscription Server</h1><p>API is online.</p><p><code>/health</code> · <code>/sub/:id</code></p></main>'));

initStorage().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`ARcodm Subscription listening on ${PORT}`))).catch(e => { console.error('Storage init failed', e); process.exit(1); });
