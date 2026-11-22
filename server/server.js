'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./logic');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WEB_DIR = path.join(__dirname, '..', 'web');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- ключи доступа ----------
// Админ (вы) и пользователь (она). Берутся из ENV, иначе генерируются один раз и сохраняются в data/keys.json.
function loadKeys() {
  const file = path.join(DATA_DIR, 'keys.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const keys = {
    admin: process.env.ADMIN_KEY || saved.admin || crypto.randomBytes(9).toString('base64url'),
    user: process.env.USER_KEY || saved.user || crypto.randomBytes(6).toString('base64url'),
  };
  if (!process.env.ADMIN_KEY || !process.env.USER_KEY) {
    fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  }
  return keys;
}
const KEYS = loadKeys();
const eq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// ---------- хранилище (JSON, атомарная запись) ----------
const DB_FILE = path.join(DATA_DIR, 'db.json');
let state;
try { state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
catch { state = L.defaultState(); }
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE);
  // простая страховка: раз в сутки копия
  const bak = path.join(DATA_DIR, `backup-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(bak)) fs.copyFileSync(DB_FILE, bak);
}
if (L.tickMonth(state)) save(); else if (!fs.existsSync(DB_FILE)) save();

// ---------- защита от перебора ключа ----------
const fails = new Map();
function throttled(ip) {
  const f = fails.get(ip);
  return f && f.n >= 8 && Date.now() - f.t < 10 * 60 * 1000;
}
function noteFail(ip) { const f = fails.get(ip) || { n: 0, t: 0 }; f.n++; f.t = Date.now(); fails.set(ip, f); }

// ---------- HTTP ----------
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new L.UserError('Слишком большой запрос')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(new L.UserError('Некорректный JSON')); } });
  });
}
const view = (admin) => ({
  config: state.config,
  balances: state.balances,
  actions: state.actions,
  tx: state.tx.slice(-(admin ? 300 : 60)).reverse(),
  claims: admin ? state.claims.filter((c) => c.status === 'pending').reverse()
    : state.claims.slice(-20).reverse(),
  role: admin ? 'admin' : 'user',
});

async function api(req, res, url) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (throttled(ip)) return send(res, 429, { error: 'Слишком много попыток, подождите 10 минут' });
  const key = req.headers['x-key'] || '';
  const role = eq(key, KEYS.admin) ? 'admin' : eq(key, KEYS.user) ? 'user' : null;
  if (!role) { noteFail(ip); return send(res, 401, { error: 'Неверный ключ доступа' }); }
  const admin = role === 'admin';
  const p = url.pathname;
  const m = req.method;

  try {
    if (L.tickMonth(state)) save();
    if (m === 'GET' && p === '/api/state') return send(res, 200, view(admin));

    const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
    let out = null;

    // --- действия «её» стороны ---
    if (m === 'POST' && p === '/api/transfer') out = L.transfer(state, body.amount);
    else if (m === 'POST' && p === '/api/spend') out = L.spend(state, body);
    else if (m === 'POST' && p === '/api/claim') out = L.createClaim(state, body.actionId, body.note);
    // --- админ ---
    else if (p.startsWith('/api/admin/')) {
      if (!admin) return send(res, 403, { error: 'Только для админа' });
      let mm;
      if (m === 'POST' && p === '/api/admin/apply') out = L.applyAction(state, body.actionId);
      else if (m === 'POST' && p === '/api/admin/adjust') out = L.adjust(state, body);
      else if (m === 'POST' && p === '/api/admin/revert') out = L.revert(state, body.txId);
      else if (m === 'PUT' && p === '/api/admin/config') state.config = L.sanitizeConfig(body, state.config);
      else if (m === 'POST' && p === '/api/admin/actions') {
        out = { id: L.nid(state), ...L.sanitizeAction(body) }; state.actions.push(out);
      } else if ((mm = p.match(/^\/api\/admin\/actions\/(\d+)$/))) {
        const i = state.actions.findIndex((a) => a.id === Number(mm[1]));
        if (i < 0) throw new L.UserError('Пункт не найден');
        if (m === 'PUT') state.actions[i] = { id: state.actions[i].id, ...L.sanitizeAction(body) };
        else if (m === 'DELETE') state.actions.splice(i, 1);
        else return send(res, 405, { error: 'Метод не поддерживается' });
      } else if ((mm = p.match(/^\/api\/admin\/claims\/(\d+)\/(approve|reject)$/)) && m === 'POST') {
        out = L.resolveClaim(state, mm[1], mm[2] === 'approve');
      } else return send(res, 404, { error: 'Не найдено' });
    } else return send(res, 404, { error: 'Не найдено' });

    save();
    return send(res, 200, { ok: true, result: out, ...view(admin) });
  } catch (e) {
    if (e instanceof L.UserError) return send(res, 400, { error: e.message });
    console.error(e); return send(res, 500, { error: 'Ошибка сервера' });
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (url.pathname === '/healthz') return send(res, 200, { ok: true });
  const rel = PAGES[url.pathname] || url.pathname.slice(1);
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Поощрения и наказания — сервер на порту ${PORT}`);
  console.log(`  Её ключ:   ${KEYS.user}`);
  console.log(`  Ваш ключ:  ${KEYS.admin}   (админка: /admin)\n`);
});
