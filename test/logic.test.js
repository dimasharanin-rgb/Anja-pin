'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../server/logic');

const d = (s) => new Date(s);
const fresh = (now = '2026-01-15T12:00:00') => { const s = L.defaultState(); L.tickMonth(s, d(now)); return s; };

test('первый запуск начисляет месяц один раз', () => {
  const s = fresh();
  assert.equal(s.balances.current, 3000);
  L.tickMonth(s, d('2026-01-20T12:00:00'));
  assert.equal(s.balances.current, 3000);
});

test('пропущенные месяцы догоняются', () => {
  const s = fresh();
  L.tickMonth(s, d('2026-04-01T00:10:00'));
  assert.equal(s.balances.current, 3000 * 4);
});

test('обычное поощрение и штраф', () => {
  const s = fresh();
  L.applyAction(s, 1, d('2026-01-16T10:00:00'));
  assert.equal(s.balances.current, 3100);
  L.applyAction(s, 3, d('2026-01-16T10:00:00'));
  assert.equal(s.balances.current, 2950);
});

test('крутое поощрение: на моментальный x1, на накопительный x1.5', () => {
  const s = fresh();
  L.applyAction(s, 2, d('2026-01-16T10:00:00'));
  assert.equal(s.balances.current, 4000);
  assert.equal(s.balances.savings, 1500);
});

test('перевод в накопительный даёт x1.2, обратно нельзя (API нет)', () => {
  const s = fresh();
  L.transfer(s, 1000, d('2026-01-16T10:00:00'));
  assert.equal(s.balances.current, 2000);
  assert.equal(s.balances.savings, 1200);
  assert.throws(() => L.transfer(s, 5000), L.UserError);
  assert.throws(() => L.transfer(s, -5), L.UserError);
});

test('накопительный тратится только на покупки от порога', () => {
  const s = fresh();
  L.applyAction(s, 2, d('2026-01-16T10:00:00')); // savings 1500
  assert.throws(() => L.spend(s, { title: 'кофта', amount: 900, source: 'savings' }), L.UserError);
  L.spend(s, { title: 'пальто', amount: 1200, source: 'savings' });
  assert.equal(s.balances.savings, 300);
  assert.throws(() => L.spend(s, { title: 'сумка', amount: 1100, source: 'savings' }), L.UserError);
});

test('трата с моментального; нельзя больше баланса', () => {
  const s = fresh();
  L.spend(s, { title: 'кофе', amount: 200, source: 'current' });
  assert.equal(s.balances.current, 2800);
  assert.throws(() => L.spend(s, { title: 'x', amount: 99999, source: 'current' }), L.UserError);
});

test('отмена операции возвращает оба счёта', () => {
  const s = fresh();
  const t = L.applyAction(s, 2, d('2026-01-16T10:00:00'));
  L.revert(s, t.id);
  assert.equal(s.balances.current, 3000);
  assert.equal(s.balances.savings, 0);
  assert.throws(() => L.revert(s, t.id), L.UserError);
});

test('заявка: подтверждение начисляет, отклонение нет', () => {
  const s = fresh();
  const c = L.createClaim(s, 1, 'сегодня');
  assert.throws(() => L.createClaim(s, 1, ''), L.UserError);
  L.resolveClaim(s, c.id, true);
  assert.equal(s.balances.current, 3100);
  const c2 = L.createClaim(s, 1, '');
  L.resolveClaim(s, c2.id, false);
  assert.equal(s.balances.current, 3100);
});

test('настройки валидируются', () => {
  const s = fresh();
  assert.throws(() => L.sanitizeConfig({ transferMultiplier: 'abc' }, s.config), L.UserError);
  assert.equal(L.sanitizeConfig({ transferMultiplier: 1.3 }, s.config).transferMultiplier, 1.3);
});
