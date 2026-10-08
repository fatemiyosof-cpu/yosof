const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
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
function publicUrl(id) {
  return `${BASE_URL || ''}/sub/${encodeURIComponent(id)}`;
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
  res.json({ ok: db !== 'postgres-error', service: 'ARcodm Subscription', version: '3.0.0', storage: db, time: iso(now()) });
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
    res.json({ ok: true, id, url: publicUrl(id), expiresAt: sub.expires_at, updated: !!old });
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
function page(s, id) {
  const expires = new Date(s.expires_at).toISOString();
  const totalGB = (() => {
    const m = String(s.volume || '').match(/([\d.]+)/); return m ? m[1] : (s.configs[0]?.data || '--');
  })();
  const configs = s.configs.map((c, i) => `<article class="cfg" style="--d:${i * 70}ms">
    <div class="flag">${esc(c.countryCode || '🌐')}</div>
    <div class="cfgmain"><b>${esc(c.country)}</b><span>${esc(c.data || totalGB)} · ${esc(c.days)} Days</span></div>
    <button class="dl" onclick="downloadOne(${i})">دانلود .conf</button>
  </article>`).join('');
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(s.panel_name || 'ARcodm')} · Subscription</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Vazirmatn,system-ui,sans-serif;background:#02070e;color:#eaf8ff}body{overflow-x:hidden}.bg{position:fixed;inset:0;z-index:-3;background:radial-gradient(circle at 20% 15%,#063b4f 0,#03101a 30%,#02070e 72%)}.aurora{position:fixed;inset:-30%;z-index:-2;filter:blur(60px);opacity:.5;background:conic-gradient(from 180deg,#00eaff,#2775ff,#8b5cf6,#00eaff);animation:spin 18s linear infinite}.noise{position:fixed;inset:0;z-index:-1;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}.wrap{width:min(760px,94vw);margin:auto;padding:30px 0 70px}.brand{text-align:center;animation:up .7s ease both}.powered{font-size:13px;letter-spacing:5px;color:#8aa5b6}.brand h1{margin:8px 0;font-size:clamp(38px,10vw,74px);font-weight:900;letter-spacing:-2px;background:linear-gradient(90deg,#fff,#5ee7ff,#8db8ff,#fff);-webkit-background-clip:text;color:transparent;background-size:300% 100%;animation:shine 5s ease infinite}.brand p{margin:0;color:#71e7ff;font-weight:700;letter-spacing:2px}.hero{margin-top:25px;padding:26px;border:1px solid #12485d;border-radius:36px;background:linear-gradient(145deg,rgba(10,31,43,.84),rgba(3,14,23,.68));box-shadow:0 25px 80px #0008,inset 0 0 40px #00d9ff0b;backdrop-filter:blur(20px);animation:up .8s .1s ease both}.timer{display:grid;place-items:center;position:relative;width:220px;height:220px;margin:0 auto 22px}.timer svg{position:absolute;inset:0;transform:rotate(-90deg)}.track{fill:none;stroke:#173444;stroke-width:10}.prog{fill:none;stroke:url(#g);stroke-width:10;stroke-linecap:round;filter:drop-shadow(0 0 10px #00d9ff);transition:stroke-dashoffset .8s}.time{font-size:40px;font-weight:900}.unit{color:#7ddff4;font-weight:700}.title{text-align:center;font-size:24px;font-weight:900;margin:8px 0}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px}.stat{padding:17px 10px;border:1px solid #1b3c4b;border-radius:22px;background:#08172299;text-align:center}.stat b{display:block;font-size:22px}.stat span{font-size:12px;color:#829eac}.section{margin-top:24px}.section h2{font-size:20px;margin:0 4px 13px}.cfgs{display:grid;gap:10px}.cfg{display:flex;align-items:center;gap:12px;padding:13px;border:1px solid #173a4b;border-radius:24px;background:linear-gradient(90deg,#081722cc,#0a1d2acc);box-shadow:0 10px 30px #0003;animation:up .6s var(--d) ease both}.flag{width:52px;height:52px;border-radius:17px;display:grid;place-items:center;background:#07141e;font-size:22px;border:1px solid #1a4b60}.cfgmain{flex:1;min-width:0}.cfgmain b{display:block;font-size:17px}.cfgmain span{display:block;color:#7d99a7;font-size:12px;margin-top:3px}.dl,.mainbtn{border:0;border-radius:17px;padding:12px 15px;font:inherit;font-weight:800;cursor:pointer;color:#021017;background:linear-gradient(135deg,#67f2ff,#4e9dff);box-shadow:0 8px 24px #00cfff2c}.mainbtn{width:100%;margin-top:12px;padding:16px;font-size:16px}.copy{margin-top:12px;padding:15px;border-radius:20px;border:1px solid #16465b;background:#071722;color:#bcefff;font-weight:800;cursor:pointer;width:100%;font:inherit}.foot{text-align:center;margin-top:25px;color:#6f8794;font-size:12px}.tg{display:inline-block;margin-top:8px;color:#70eaff;text-decoration:none;font-weight:800}.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;padding:12px 17px;border-radius:15px;background:#071722;border:1px solid #1e5a70;transition:.25s;z-index:5}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}@keyframes up{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}@keyframes shine{0%,100%{background-position:0%}50%{background-position:100%}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:560px){.wrap{padding-top:18px}.hero{padding:18px;border-radius:28px}.timer{width:190px;height:190px}.time{font-size:32px}.meta{gap:7px}.stat{padding:13px 5px}.stat b{font-size:18px}.cfg{border-radius:20px}.dl{padding:10px;font-size:12px}}
  </style></head><body><div class="bg"></div><div class="aurora"></div><div class="noise"></div><main class="wrap">
  <header class="brand"><div class="powered">POWERED BY YOSOF</div><h1>ARcodm</h1><p>SUBSCRIPTION CENTER</p></header>
  <section class="hero"><div class="timer"><svg viewBox="0 0 220 220"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#52f3ff"/><stop offset=".5" stop-color="#459cff"/><stop offset="1" stop-color="#9a6cff"/></linearGradient></defs><circle class="track" cx="110" cy="110" r="96"/><circle id="prog" class="prog" cx="110" cy="110" r="96"/></svg><div><div id="time" class="time">--:--:--</div><div class="unit">زمان باقی‌مانده</div></div></div>
    <div class="title">${esc(s.panel_name || s.profile || 'My-Config')}</div><div class="meta"><div class="stat"><b>${s.configs.length}</b><span>لوکیشن فعال</span></div><div class="stat"><b>${esc(totalGB)} GB</b><span>حجم</span></div><div class="stat"><b>${esc(s.days)}</b><span>روز</span></div></div>
    <div class="section"><h2>🌍 لوکیشن‌ها</h2><div class="cfgs">${configs}</div><button class="mainbtn" onclick="downloadAll()">📦 دانلود همه کانفیگ‌ها</button><button class="copy" onclick="copySub()">🔗 کپی لینک Subscription</button></div>
  </section><footer class="foot">ARcodm Creator · Powered by Yosof<br><a class="tg" href="${esc(TELEGRAM_URL)}" target="_blank" rel="noopener">↗ View Creator Channel</a></footer></main><div id="toast" class="toast"></div>
  <script>
  const DATA=${safeJson(s.configs)}; const EXP=${JSON.stringify(expires)}; const SUB=location.href; const R=96*2*Math.PI; const prog=document.getElementById('prog'); prog.style.strokeDasharray=R; function tick(){const ms=Math.max(0,new Date(EXP)-Date.now());const sec=Math.floor(ms/1000),d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60;document.getElementById('time').textContent=(d?d+'d ':'')+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');const total=${Math.max(1,s.days)}*86400000;prog.style.strokeDashoffset=R*(1-Math.min(1,ms/total));if(ms<=0)document.title='Subscription Expired · ARcodm'} tick();setInterval(tick,1000);
  function toast(t){const x=document.getElementById('toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),1800)}
  function blobDownload(name,content){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));a.download=name.replace(/[^a-zA-Z0-9._-]/g,'_')+'.conf';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function downloadOne(i){const c=DATA[i];blobDownload(c.name||('config-'+(i+1)),c.content);toast('دانلود شروع شد ✓')}
  function downloadAll(){DATA.forEach((c,i)=>setTimeout(()=>downloadOne(i),i*180));toast('دانلود همه کانفیگ‌ها شروع شد ✓')}
  async function copySub(){try{await navigator.clipboard.writeText(SUB);toast('لینک Subscription کپی شد ✓')}catch{toast('کپی لینک انجام نشد')}}
  </script></body></html>`;
}

app.get('/sub/:id', async (req, res) => {
  try {
    const s = await getSub(String(req.params.id || ''));
    if (!isValidSub(s)) return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Subscription Not Found</title><style>body{font-family:system-ui;background:#02070e;color:#fff;display:grid;place-items:center;min-height:100vh}main{text-align:center}h1{font-size:42px}p{color:#8ba0ad}</style><main><h1>Subscription Not Found</h1><p>این Subscription وجود ندارد یا منقضی شده است.</p></main>');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(page(s, req.params.id));
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
});

app.get('/', (_req, res) => res.send('<!doctype html><meta charset="utf-8"><title>ARcodm Subscription API</title><style>body{font-family:system-ui;background:#02070e;color:#fff;display:grid;place-items:center;min-height:100vh}main{max-width:650px;padding:30px;text-align:center}code{color:#65eaff}</style><main><h1>ARcodm Subscription Server</h1><p>API is online.</p><p><code>/health</code> · <code>/sub/:id</code></p></main>'));

initStorage().then(() => app.listen(PORT, () => console.log(`ARcodm Subscription listening on ${PORT}`))).catch(e => { console.error('Storage init failed', e); process.exit(1); });
