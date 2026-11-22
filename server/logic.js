'use strict';
// Чистая бизнес-логика: никакого ввода-вывода, вся математика денег тут.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function defaultState() {
  return {
    config: {
      title: 'Поощрения и наказания',
      currency: '₽',
      monthlyAmount: 3000,        // стартовая сумма, капает каждый месяц на «моментальный»
      bigBonusMultiplier: 1.5,    // «крутое» поощрение: столько × суммы летит в крупно-накопительный
      transferMultiplier: 1.2,    // самостоятельный перевод моментальный → накопительный
      bigPurchaseThreshold: 1000, // накопительный тратится только на покупки от этой суммы
    },
    balances: { current: 0, savings: 0 },
    lastMonth: null,
    actions: [
      { id: 1, title: 'Помыла посуду', type: 'bonus', amount: 100, big: false },
      { id: 2, title: 'Сделала что-то очень крутое', type: 'bonus', amount: 1000, big: true },
      { id: 3, title: 'Забыла написать, что дошла', type: 'penalty', amount: 150, big: false },
    ],
    tx: [],
    claims: [],
    nextId: 10,
  };
}

const monthIndex = (d) => d.getFullYear() * 12 + d.getMonth();
const monthKey = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
const keyToIndex = (k) => { const [y, m] = k.split('-').map(Number); return y * 12 + (m - 1); };

function nid(s) { return s.nextId++; }

function pushTx(s, now, kind, title, dCurrent, dSavings, extra = {}) {
  dCurrent = round2(dCurrent); dSavings = round2(dSavings);
  s.balances.current = round2(s.balances.current + dCurrent);
  s.balances.savings = round2(s.balances.savings + dSavings);
  const tx = { id: nid(s), ts: now.toISOString(), kind, title, dCurrent, dSavings, reverted: false, ...extra };
  s.tx.push(tx);
  if (s.tx.length > 5000) s.tx.splice(0, s.tx.length - 5000);
  return tx;
}

class UserError extends Error {}
const fail = (m) => { throw new UserError(m); };
const pos = (v, what = 'Сумма') => {
  const n = round2(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${what} должна быть больше нуля`);
  return n;
};

// Ежемесячное начисление. Вызывается при каждом обращении; пропущенные месяцы догоняет.
function tickMonth(s, now = new Date()) {
  const cur = monthIndex(now);
  if (s.lastMonth == null) {
    s.lastMonth = monthKey(cur - 1); // первый запуск: начисляем за текущий месяц
  }
  let last = keyToIndex(s.lastMonth);
  let changed = false;
  if (last > cur) { s.lastMonth = monthKey(cur); return true; } // часы переставили назад
  while (last < cur && s.config.monthlyAmount > 0) {
    last += 1;
    pushTx(s, now, 'monthly', `Ежемесячное начисление (${monthKey(last)})`, s.config.monthlyAmount, 0);
    changed = true;
  }
  if (last !== keyToIndex(s.lastMonth)) { s.lastMonth = monthKey(last); changed = true; }
  return changed;
}

function applyAction(s, actionId, now = new Date(), note = '') {
  const a = s.actions.find((x) => x.id === Number(actionId));
  if (!a) fail('Такого пункта нет в списке');
  const title = note ? `${a.title} (${note})` : a.title;
  if (a.type === 'penalty') {
    return pushTx(s, now, 'penalty', a.title, -a.amount, 0, { actionId: a.id });
  }
  const toSavings = a.big ? a.amount * s.config.bigBonusMultiplier : 0;
  return pushTx(s, now, a.big ? 'bonus_big' : 'bonus', title, a.amount, toSavings, { actionId: a.id });
}

function transfer(s, amount, now = new Date()) {
  amount = pos(amount);
  if (amount > s.balances.current) fail('На моментальном счёте не хватает денег');
  const got = round2(amount * s.config.transferMultiplier);
  return pushTx(s, now, 'transfer', 'Перевод в накопительный', -amount, got);
}

function spend(s, { title, amount, source }, now = new Date()) {
  amount = pos(amount);
  title = String(title || '').trim().slice(0, 120);
  if (!title) fail('Напиши, на что тратишь');
  if (source === 'savings') {
    if (amount < s.config.bigPurchaseThreshold)
      fail(`Накопительный счёт — только для покупок от ${s.config.bigPurchaseThreshold} ${s.config.currency}`);
    if (amount > s.balances.savings) fail('На накопительном счёте не хватает денег');
    return pushTx(s, now, 'spend', title, 0, -amount, { source });
  }
  if (amount > s.balances.current) fail('На моментальном счёте не хватает денег');
  return pushTx(s, now, 'spend', title, -amount, 0, { source: 'current' });
}

function adjust(s, { title, amount, target }, now = new Date()) {
  amount = round2(amount);
  if (!Number.isFinite(amount) || amount === 0) fail('Сумма не может быть нулевой');
  title = String(title || 'Ручная корректировка').slice(0, 120);
  return target === 'savings'
    ? pushTx(s, now, 'adjust', title, 0, amount)
    : pushTx(s, now, 'adjust', title, amount, 0);
}

function revert(s, txId, now = new Date()) {
  const t = s.tx.find((x) => x.id === Number(txId));
  if (!t) fail('Операция не найдена');
  if (t.reverted) fail('Операция уже отменена');
  if (t.revertOf) fail('Отмену отменить нельзя');
  t.reverted = true;
  return pushTx(s, now, 'revert', `Отмена: ${t.title}`, -t.dCurrent, -t.dSavings, { revertOf: t.id });
}

function createClaim(s, actionId, note, now = new Date()) {
  const a = s.actions.find((x) => x.id === Number(actionId));
  if (!a) fail('Такого пункта нет в списке');
  if (s.claims.some((c) => c.status === 'pending' && c.actionId === a.id)) fail('Заявка уже отправлена, ждём подтверждения');
  const c = { id: nid(s), ts: now.toISOString(), actionId: a.id, title: a.title, type: a.type, amount: a.amount,
    note: String(note || '').slice(0, 200), status: 'pending' };
  s.claims.push(c);
  if (s.claims.length > 500) s.claims.splice(0, s.claims.length - 500);
  return c;
}

function resolveClaim(s, claimId, approve, now = new Date()) {
  const c = s.claims.find((x) => x.id === Number(claimId));
  if (!c) fail('Заявка не найдена');
  if (c.status !== 'pending') fail('Заявка уже обработана');
  if (approve) applyAction(s, c.actionId, now, c.note);
  c.status = approve ? 'approved' : 'rejected';
  c.resolvedAt = now.toISOString();
  return c;
}

function sanitizeConfig(input, old) {
  const out = { ...old };
  const num = (k, min, max) => {
    if (input[k] === undefined) return;
    const v = Number(input[k]);
    if (!Number.isFinite(v) || v < min || v > max) fail(`Некорректное значение: ${k}`);
    out[k] = round2(v);
  };
  num('monthlyAmount', 0, 1e9);
  num('bigBonusMultiplier', 0, 100);
  num('transferMultiplier', 0, 100);
  num('bigPurchaseThreshold', 0, 1e9);
  if (input.title !== undefined) out.title = String(input.title).trim().slice(0, 60) || old.title;
  if (input.currency !== undefined) out.currency = String(input.currency).trim().slice(0, 6) || old.currency;
  return out;
}

function sanitizeAction(input) {
  const title = String(input.title || '').trim().slice(0, 100);
  if (!title) fail('Нужно название');
  const type = input.type === 'penalty' ? 'penalty' : 'bonus';
  const amount = pos(input.amount);
  return { title, type, amount, big: type === 'bonus' && !!input.big };
}

module.exports = { defaultState, tickMonth, applyAction, transfer, spend, adjust, revert,
  createClaim, resolveClaim, sanitizeConfig, sanitizeAction, UserError, round2, nid };
