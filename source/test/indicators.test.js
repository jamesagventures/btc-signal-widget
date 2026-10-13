const assert = require('assert');
const I = require('../src/indicators.js');

// RSI reference: classic 14-period dataset (closes), expected RSI ≈ 70.53 at index 14 (Wilder example).
const closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64];
const r = I.rsi(closes, 14);
assert.ok(Math.abs(r[14] - 70.53) < 0.1, `RSI[14]=${r[14]}`);
assert.ok(r[13] === null && r[14] != null, 'RSI warmup');

// EMA/MACD sanity: constant series -> macd 0
const flat = Array(60).fill(100);
const m = I.macd(flat);
assert.ok(Math.abs(m.macd[59]) < 1e-9 && Math.abs(m.signal[59]) < 1e-9, 'MACD flat');
// Rising series -> positive MACD
const up = Array.from({ length: 60 }, (_, i) => 100 + i);
assert.ok(I.macd(up).macd[59] > 0, 'MACD rising positive');

// Weekly aggregation: 14 daily candles starting Mon 2024-01-01 -> 2 weeks
const daily = Array.from({ length: 14 }, (_, i) => ({ t: Date.UTC(2024, 0, 1 + i), o: 10 + i, h: 20 + i, l: 5 + i, c: 11 + i }));
const w = I.toWeekly(daily);
assert.strictEqual(w.length, 2);
assert.deepStrictEqual([w[0].o, w[0].h, w[0].l, w[0].c], [10, 26, 5, 17]);

// Signal rules
const ev = (o) => I.evaluate(o);
assert.strictEqual(ev({ fg: 29 }).votes.fearGreed, 'buy');
assert.strictEqual(ev({ fg: 30 }).votes.fearGreed, 'neutral');
assert.strictEqual(ev({ fg: 71 }).votes.fearGreed, 'sell');
assert.strictEqual(ev({ longUsd: 400, shortUsd: 100 }).votes.liquidation, 'sell');
assert.strictEqual(ev({ longUsd: 100, shortUsd: 400 }).votes.liquidation, 'buy');
assert.strictEqual(ev({ longUsd: 300, shortUsd: 100 }).votes.liquidation, 'neutral');
assert.strictEqual(ev({ rsiNow: 55, rsiPrev: 50 }).votes.rsi, 'neutral');  // rising but not <30
assert.strictEqual(ev({ rsiNow: 28, rsiPrev: 25 }).votes.rsi, 'buy');      // <30 and rising
assert.strictEqual(ev({ rsiNow: 25, rsiPrev: 28 }).votes.rsi, 'neutral');  // <30 but falling
assert.strictEqual(ev({ rsiNow: 72, rsiPrev: 75 }).votes.rsi, 'sell');     // >70 and falling
assert.strictEqual(ev({ rsiNow: 75, rsiPrev: 72 }).votes.rsi, 'neutral');  // >70 but rising
assert.strictEqual(ev({ macdNow: -5, macdPrev: -2 }).votes.macd, 'sell');
const full = ev({ fg: 20, longUsd: 1, shortUsd: 10, rsiNow: 18, rsiPrev: 15, macdNow: 1, macdPrev: 2 });
assert.strictEqual(full.overall, 'buy'); assert.strictEqual(full.buys, 3); assert.strictEqual(full.sells, 1);
assert.strictEqual(ev({ fg: 50 }).overall, 'hold');
console.log('all indicator tests passed');
