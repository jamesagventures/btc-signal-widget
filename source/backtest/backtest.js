// Backtest of the widget's strategy using the SAME scoring code (src/indicators.js).
// Usage: node backtest/backtest.js <hourly.csv: t,o,h,l,c (unix sec)> [out.json] [startISO]
//
// Engine runs hour by hour:
//   - Normal signals (composite + mode gate) are evaluated on each DAILY close and fill at the next hour's open.
//   - Flash crashes are detected on HOURLY candles (exactly like the live widget) and fill at the next hour's open.
//   - Stops, partials and trailing are checked every hour.
// Rules (from the spec):
//   FULL = 100% of capital, HALF / crash = 50%. Fees 0.1% per side.
//   Hard stop 1.75×ATR below entry (crash buys: 0.5×ATR under the crash low).
//   Trail 1.75×ATR under the highest daily close once in profit. Take 50% at +10%.
//   Time stop: out after 21 days unless ≥ +3%. Mode exit signal → exit.
// Funding / OI / positioning / Fear & Greed have no long history here → left out; composite re-weights
// over trend / MACD / RSI (same as the widget when a feed is missing).
const fs = require('fs');
const I = require('../src/indicators.js');

const FEE = 0.001, ATR_MULT = 1.75, PARTIAL_AT = 0.10, TIME_STOP_DAYS = 21, TIME_STOP_MIN = 0.03;
const HOUR = 3600e3, DAY = 86400e3;

function loadHourly(p) {
  return fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).map(l => {
    const [t, o, h, lo, c] = l.split(','); return { t: +t * 1000, o: +o, h: +h, l: +lo, c: +c };
  });
}
function toDaily(hourly) {
  const out = []; let cur = null;
  for (const x of hourly) {
    const d = x.t - (x.t % DAY);
    if (!cur || cur.t !== d) { cur = { t: d, o: x.o, h: x.h, l: x.l, c: x.c, hours: [] }; out.push(cur); }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; }
    cur.hours.push(x);
  }
  return out;
}

function run(daily, hourlyAll, { mode, crash, startIdx, crashOpts = {}, crashHoldDays = TIME_STOP_DAYS }) {
  const closes = daily.map(d => d.c);
  const sma200 = I.sma(closes, 200), m = I.macd(closes), r = I.rsi(closes, 14), a = I.atr(daily, 14);
  let cash = 1, units = 0, pos = null, pending = null, crashUsedUntil = 0;
  const trades = [], equity = [];
  const hourIndex = new Map(hourlyAll.map((h, i) => [h.t, i]));

  const value = px => cash + units * px;
  const buy = (px, size, t, meta) => {
    const eq = value(px), spend = Math.min(cash, eq * size - units * px);
    if (spend <= eq * 0.01) return;
    units += spend * (1 - FEE) / px; cash -= spend;
    if (!pos) {
      pos = { entry: px, stop: meta.stop, peakClose: px, size, partialDone: false, entryT: t, tag: meta.tag };
      trades.push({ entryT: t, entry: px, tag: meta.tag, legs: [] });
    } else pos.size = size;
  };
  const sell = (fraction, px, t, why) => {
    const u = units * fraction; cash += u * px * (1 - FEE); units -= u;
    trades.at(-1).legs.push({ px, frac: fraction, why, t });
    if (units < 1e-12) { units = 0; trades.at(-1).exitT = t; trades.at(-1).exitWhy = why; pos = null; }
  };

  for (let i = startIdx; i < daily.length; i++) {
    const day = daily[i], atrPrev = a[i - 1];
    for (const hr of day.hours) {
      // fill pending at this hour's open
      if (pending) {
        if (pending.type === 'buy') buy(hr.o, pending.size, hr.t, { tag: pending.tag, stop: pending.stop ?? hr.o - ATR_MULT * pending.atr });
        else if (units > 0) sell(1, hr.o, hr.t, pending.why);
        pending = null;
      }
      // stops / partial
      if (pos) {
        if (hr.l <= pos.stop) sell(1, Math.min(hr.o, pos.stop), hr.t, 'stop');
        else if (!pos.partialDone && hr.h >= pos.entry * (1 + PARTIAL_AT)) { sell(0.5, pos.entry * (1 + PARTIAL_AT), hr.t, 'partial +10%'); if (pos) pos.partialDone = true; }
      }
      // flash crash detection at hour close (only when flat or holding less than half)
      if (crash && (!pos || pos.size < 0.5) && !pending && hr.t >= crashUsedUntil && atrPrev) {
        const hi = hourIndex.get(hr.t), win = hourlyAll.slice(Math.max(0, hi - 72), hi + 1);
        let mx = 0, mn = Infinity; for (const c of win) { if (c.h > mx) mx = c.h; if (c.l < mn) mn = c.l; }
        if ((mx - mn) / mx >= (crashOpts.drop ?? I.CRASH_DEFAULTS.drop)) {
          const fc = I.detectFlashCrash(win, hr.c, atrPrev, hr.t + HOUR - 1, crashOpts);
          if (fc.state === 'buy') { pending = { type: 'buy', size: 0.5, tag: 'crash', stop: fc.stop }; crashUsedUntil = fc.expires; }
        }
      }
    }

    // daily close: normal signal
    const price = closes[i], s = sma200[i], hN = m.hist[i], hP = m.hist[i - 1], rN = r[i];
    const score = I.composite({ trend: I.scoreTrend(price, s, mode), macd: I.scoreMacd(hN, hP), rsi: I.scoreRsi(rN, s != null && price > s) });
    const d = I.decide({ mode, score, price, sma200: s, histNow: hN, histPrev: hP, rsi: rN, fg: null });
    if (pos) {
      pos.peakClose = Math.max(pos.peakClose, price);
      if (price > pos.entry && a[i]) pos.stop = Math.max(pos.stop, pos.peakClose - ATR_MULT * a[i]);
      const held = (day.t + DAY - pos.entryT) / DAY;
      if (!pending) {
        if (pos.tag !== 'crash' && d.exit) pending = { type: 'sell', why: 'exit signal' };
        else if (held >= TIME_STOP_DAYS && price < pos.entry * (1 + TIME_STOP_MIN)) pending = { type: 'sell', why: 'time stop' };
        else if (pos.tag === 'crash' && held >= crashHoldDays) pending = { type: 'sell', why: 'crash trade done' };
        else if (d.size > pos.size) { pending = { type: 'buy', size: d.size, atr: a[i], tag: pos.tag }; }
      }
    } else if (!pending && d.size > 0) pending = { type: 'buy', size: d.size, atr: a[i], tag: 'signal' };
    equity.push({ t: day.t, eq: value(price), px: price, inMkt: units > 0 });
  }
  if (units > 0) sell(1, closes.at(-1), daily.at(-1).t, 'end of test');
  for (const t of trades) {
    let proceeds = 0, frac = 1;
    for (const l of t.legs) { proceeds += frac * l.frac * l.px * (1 - FEE); frac -= frac * l.frac; }
    t.ret = proceeds / (t.entry * (1 + FEE)) - 1;
  }
  return { equity, trades };
}

function stats(equity, trades, label) {
  const e = equity.map(x => x.eq), years = (equity.at(-1).t - equity[0].t) / (365.25 * DAY);
  let peak = -Infinity, mdd = 0; for (const v of e) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const wins = trades.filter(t => t.ret > 0), losses = trades.filter(t => t.ret <= 0);
  const gw = wins.reduce((s, t) => s + t.ret, 0), gl = -losses.reduce((s, t) => s + t.ret, 0);
  return { label, total: e.at(-1) / e[0] - 1, cagr: Math.pow(e.at(-1) / e[0], 1 / years) - 1, maxDD: mdd,
    trades: trades.length, perYear: trades.length / years, winRate: trades.length ? wins.length / trades.length : null,
    profitFactor: gl > 0 ? gw / gl : null, timeInMarket: equity.filter(x => x.inMkt).length / equity.length };
}
function byYear(equity) {
  const out = {};
  for (const x of equity) { const y = new Date(x.t).getUTCFullYear(); (out[y] ||= { first: x, last: x }).last = x; }
  return Object.fromEntries(Object.entries(out).map(([y, v]) => [y, { strat: v.last.eq / v.first.eq - 1, hodl: v.last.px / v.first.px - 1 }]));
}

module.exports = { run, stats, loadHourly, toDaily };
if (require.main !== module) return;
// ---- main ----
const hourly = loadHourly(process.argv[2]);
const startISO = process.argv[4] || '2015-01-01';
const fromT = Date.parse(startISO);
const hourlyUse = hourly.filter(h => h.t >= fromT);
const daily = toDaily(hourlyUse);
const startIdx = 230;
const results = [];
for (const mode of I.MODES) for (const crash of [false, true]) {
  const { equity, trades } = run(daily, hourlyUse, { mode, crash, startIdx });
  const crashT = trades.filter(t => t.tag === 'crash');
  results.push({ mode, crash, ...stats(equity, trades, `${I.MODE_LABELS[mode]}${crash ? ' + flash crash' : ''}`),
    years: byYear(equity), equity: equity.filter((_, k) => k % 7 === 0).map(x => [x.t, +x.eq.toFixed(5)]),
    crashTrades: crashT.map(t => ({ date: new Date(t.entryT).toISOString().slice(0, 13), ret: +t.ret.toFixed(4), exit: t.exitWhy })),
    exits: trades.reduce((o, t) => (o[t.exitWhy] = (o[t.exitWhy] || 0) + 1, o), {}) });
}
const bhEq = daily.slice(startIdx).map(d => ({ t: d.t, eq: d.c, px: d.c, inMkt: true }));
const hodl = { ...stats(bhEq, [], 'Buy & hold'), trades: null, perYear: null, winRate: null, profitFactor: null,
  years: byYear(bhEq), equity: bhEq.filter((_, k) => k % 7 === 0).map(x => [x.t, +(x.eq / bhEq[0].eq).toFixed(5)]) };

const fmt = v => v == null ? '    —' : `${(v * 100).toFixed(0).padStart(5)}%`;
console.log(`Test window: ${new Date(daily[startIdx].t).toISOString().slice(0, 10)} → ${new Date(daily.at(-1).t).toISOString().slice(0, 10)}\n`);
console.log('Strategy'.padEnd(32), ' Total', '  CAGR', ' MaxDD', 'Trades', ' /yr', '  Win%', '   PF', ' InMkt');
for (const s of [...results, hodl]) console.log(s.label.padEnd(32), fmt(s.total), fmt(s.cagr), fmt(s.maxDD),
  String(s.trades ?? '—').padStart(6), s.perYear != null ? s.perYear.toFixed(1).padStart(5) : '    —', fmt(s.winRate),
  s.profitFactor != null ? s.profitFactor.toFixed(2).padStart(6) : '     —', fmt(s.timeInMarket));
const cr = results.filter(x => x.crash)[0].crashTrades;
const w = cr.filter(t => t.ret > 0);
console.log(`\nFlash-crash trades (hourly detector): ${cr.length}, winners ${w.length}, avg ${(cr.reduce((s, t) => s + t.ret, 0) / cr.length * 100).toFixed(1)}%`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ window: [daily[startIdx].t, daily.at(-1).t], results, hodl }));
