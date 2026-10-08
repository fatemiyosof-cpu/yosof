const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.SUBSCRIPTION_ADMIN_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Subscription-Admin-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); }
  catch { return {}; }
}
function saveStore(store) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
function cleanText(v, fallback='') { return String(v ?? fallback).slice(0, 500); }
function cleanConfig(c) {
  return {
    name: cleanText(c.name, 'Config'),
    country: cleanText(c.country, 'Unknown'),
    countryCode: cleanText(c.countryCode, 'XX').toUpperCase().slice(0, 3),
    data: cleanText(c.data, '--'),
    days: cleanText(c.days, '--'),
    content: String(c.content || '').slice(0, 30000)
  };
}
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const supplied = req.get('X-Subscription-Admin-Token') || '';
  if (supplied !== ADMIN_TOKEN) return res.status(401).json({ error: 'admin_token_required' });
  next();
}
function publicUrl(req, id) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/sub/${encodeURIComponent(id)}`;
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'ARcodm Subscription', version: '1.0.0' }));

app.post('/api/subscriptions', requireAdmin, (req, res) => {
  const body = req.body || {};
  const profile = cleanText(body.profile, 'My-Config');
  const configs = Array.isArray(body.configs) ? body.configs.map(cleanConfig).filter(c => c.content) : [];
  if (!configs.length) return res.status(400).json({ error: 'no_configs' });

  const id = crypto.randomBytes(9).toString('base64url');
  const store = loadStore();
  store[id] = {
    id,
    panelName: cleanText(body.panelName, 'PANEL'),
    profile,
    volume: cleanText(body.volume, configs[0].data || '--'),
    days: cleanText(body.days, configs[0].days || '--'),
    createdAt: new Date().toISOString(),
    configs
  };
  saveStore(store);
  res.json({ ok: true, id, url: publicUrl(req, id) });
});

app.get('/sub/:id', (req, res) => {
  const sub = loadStore()[req.params.id];
  if (!sub) return res.status(404).send('Subscription not found');
  const esc = x => String(x ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const flags = {IR:'🇮🇷',TR:'🇹🇷',AE:'🇦🇪',BY:'🇧🇾',SA:'🇸🇦',QA:'🇶🇦'};
  const rows = sub.configs.map((c,i) => `
    <div class="loc">
      <div><b>${flags[c.countryCode] || '🌐'} ${esc(c.country)}</b><small>${esc(c.data)} · ${esc(c.days)}</small></div>
      <a href="/sub/${encodeURIComponent(sub.id)}/config/${i}" download>دانلود .conf</a>
    </div>`).join('');
  res.type('html').send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(sub.profile)} - Subscription</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#eefcff;color:#12343a}.wrap{max-width:680px;margin:40px auto;padding:18px}.card{background:#fff;border:1px solid #d8f1f4;border-radius:22px;padding:22px;box-shadow:0 18px 50px #0a8fa018}.brand{font-size:12px;color:#07869a;font-weight:800}.title{font-size:26px;font-weight:950;margin:8px 0}.meta{display:flex;gap:10px;flex-wrap:wrap}.pill{background:#effcff;border:1px solid #d5f3f6;border-radius:12px;padding:9px 12px;font-weight:800}.loc{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px;border:1px solid #e7eef0;border-radius:15px;margin-top:9px}.loc small{display:block;color:#789096;margin-top:4px}.loc a{background:#08a5b7;color:#fff;text-decoration:none;padding:9px 12px;border-radius:10px;font-weight:800;font-size:12px}.note{font-size:11px;color:#708187;line-height:1.8;margin-top:16px}</style></head><body><main class="wrap"><section class="card"><div class="brand">${esc(sub.panelName)} · SUBSCRIPTION</div><div class="title">${esc(sub.profile)}</div><div class="meta"><div class="pill">⏱ ${esc(sub.days)}</div><div class="pill">💾 ${esc(sub.volume)}</div><div class="pill">🌍 ${sub.configs.length} لوکیشن</div></div><h3>لوکیشن‌ها</h3>${rows}<p class="note">این لینک یک Subscription اختصاصی برای این کانفیگ است. باز کردن لینک باعث کم شدن حجم یا زمان نمی‌شود؛ مقادیر بالا اطلاعات ثابت اشتراک هستند.</p></section></main></body></html>`);
});

app.get('/sub/:id/config/:index', (req, res) => {
  const sub = loadStore()[req.params.id];
  const index = Number(req.params.index);
  if (!sub || !Number.isInteger(index) || !sub.configs[index]) return res.status(404).send('Config not found');
  const c = sub.configs[index];
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${c.countryCode}_${c.name.replace(/[^A-Za-z0-9_-]/g,'_')}.conf"`);
  res.send(c.content);
});

app.get('/sub/:id/data.json', (req, res) => {
  const sub = loadStore()[req.params.id];
  if (!sub) return res.status(404).json({ error: 'not_found' });
  res.json({ id: sub.id, panelName: sub.panelName, profile: sub.profile, volume: sub.volume, days: sub.days, configs: sub.configs.map((c,i)=>({index:i,name:c.name,country:c.country,countryCode:c.countryCode,data:c.data,days:c.days,url:`/sub/${encodeURIComponent(sub.id)}/config/${i}`})) });
});

app.listen(PORT, () => console.log(`ARcodm Subscription server listening on ${PORT}`));
