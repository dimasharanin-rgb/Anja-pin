'use strict';
const KEY_STORE = 'pnp_key';
let KEY = '';
try { KEY = localStorage.getItem(KEY_STORE) || ''; } catch {}

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, cur) => `${(Math.round(n * 100) / 100).toLocaleString('ru-RU')} ${cur || ''}`.trim();
const sgn = (n, cur) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), cur)}`;
const when = (iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
  document.body.append(el); setTimeout(() => el.remove(), 3200);
}

async function call(method, path, body) {
  const r = await fetch((window.SERVER_BASE || '') + path, {
    method, headers: { 'content-type': 'application/json', 'x-key': KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {}
  if (r.status === 401) { const e = new Error(j.error || 'Нет доступа'); e.auth = true; throw e; }
  if (!r.ok) throw new Error(j.error || `Ошибка ${r.status}`);
  return j;
}

function setKey(k) { KEY = k.trim(); try { localStorage.setItem(KEY_STORE, KEY); } catch {} }
function logout() { KEY = ''; try { localStorage.removeItem(KEY_STORE); } catch {} location.reload(); }

function txLabel(t) {
  return { monthly: '📅', bonus: '✨', bonus_big: '🌟', penalty: '⚠️', transfer: '🔁', spend: '🛍️', adjust: '✏️', revert: '↩️' }[t.kind] || '•';
}

function txRow(t, cur, extra = '') {
  const parts = [];
  if (t.dCurrent) parts.push(`<span class="amt ${t.dCurrent > 0 ? 'plus' : 'minus'}">${sgn(t.dCurrent, cur)}</span>`);
  if (t.dSavings) parts.push(`<span class="amt ${t.dSavings > 0 ? 'plus' : 'minus'}">💎 ${sgn(t.dSavings, cur)}</span>`);
  return `<div class="item" style="${t.reverted ? 'opacity:.5;text-decoration:line-through' : ''}">
    <div style="font-size:20px">${txLabel(t)}</div>
    <div class="t"><b>${esc(t.title)}</b><small>${when(t.ts)}</small></div>
    <div style="text-align:right;display:flex;flex-direction:column;gap:2px">${parts.join('')}</div>${extra}</div>`;
}

function loginScreen(root, onOk, title) {
  root.innerHTML = `<div class="login card"><h1>${esc(title)}</h1>
    <p class="hint">Введи ключ доступа</p>
    <input id="k" type="password" autocomplete="current-password" placeholder="ключ"><br><br>
    <button id="go" style="width:100%">Войти</button><p id="err" class="hint" style="color:var(--bad)"></p></div>`;
  const go = async () => {
    setKey($('#k').value);
    try { await onOk(); } catch (e) { $('#err').textContent = e.message; }
  };
  $('#go').onclick = go; $('#k').onkeydown = (e) => e.key === 'Enter' && go();
}
