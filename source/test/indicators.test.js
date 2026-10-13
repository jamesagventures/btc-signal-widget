const assert = require('assert');
const I = require('../src/indicators.js');

// --- indicators ---
const closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64];
assert.ok(Math.abs(I.rsi(closes, 14)[14] - 70.53) < 0.1, 'RSI Wilder reference');
assert.deepStrictEqual(I.sma([1,2,3,4,5], 3), [null, null, 2, 3, 4], 'SMA');
const flat = Array(60).fill(100);
assert.ok(Math.abs(I.macd(flat).hist[59]) < 1e-9, 'MACD flat');
assert.ok(I.macd(Array.from({ length: 60 }, (_, i) => 100 + i)).macd[59] > 0, 'MACD rising');
const atrC = Array.from({ length: 30 }, () => ({ h: 110, l: 100, c: 105 }));
assert.ok(Math.abs(I.atr(atrC, 14)[29] - 10) < 1e-9, 'ATR constant range');
assert.strictEqual(I.pctRank([1,2,3,4], 5), 100); assert.strictEqual(I.pctRank([1,2,3,4], 0), 0);

// --- factor scores ---
assert.strictEqual(I.scoreTrend(101, 100), 100);
assert.strictEqual(I.scoreTrend(98, 100), 30);   // mildly below
assert.strictEqual(I.scoreTrend(90, 100), 0);
assert.strictEqual(I.scoreMacd(5, 3), 90); assert.strictEqual(I.scoreMacd(5, 7), 70);
assert.strictEqual(I.scoreMacd(-5, -7), 35); assert.strictEqual(I.scoreMacd(-5, -3), 10);
assert.strictEqual(I.scoreRsi(25, true), 95); assert.strictEqual(I.scoreRsi(50, true), 85);
assert.strictEqual(I.scoreRsi(50, false), 50); assert.strictEqual(I.scoreRsi(75, true), 15);
assert.strictEqual(I.scoreFunding(-0.00001, 5, 0), 100);   // negative funding + flat OI
assert.strictEqual(I.scoreFunding(0.00003, 90, 0.08), 0);  // high funding + rising OI → crowded
assert.strictEqual(I.scorePositioning(10), 90); assert.strictEqual(I.scorePositioning(90), 15);
assert.strictEqual(I.scoreFearGreed(20), 90); assert.strictEqual(I.scoreFearGreed(80), 10);
assert.strictEqual(I.scoreFearGreed(50), 50);

// --- composite: weights sum to 1; missing factor renormalises ---
assert.ok(Math.abs(Object.values(I.WEIGHTS).reduce((s, v) => s + v, 0) - 1) < 1e-9);
assert.strictEqual(I.composite({ trend: 100, macd: 100, rsi: 100, funding: 100, positioning: 100, fearGreed: 100 }), 100);
assert.strictEqual(I.composite({ trend: 100, macd: 0 }), Math.round(100 * 0.25 / 0.45));

// --- decision rules ---
const d = (o) => I.decide(o);
assert.strictEqual(d({ score: 75, price: 110, sma200: 100, histNow: 1 }).call, 'FULL LONG');
assert.strictEqual(d({ score: 60, price: 110, sma200: 100, histNow: 1 }).call, 'HALF SIZE');
assert.strictEqual(d({ score: 80, price: 90, sma200: 100, histNow: 1 }).call, 'NO TRADE');   // below 200d
assert.strictEqual(d({ score: 80, price: 110, sma200: 100, histNow: -1 }).call, 'NO TRADE');  // hist negative
assert.strictEqual(d({ score: 50, price: 110, sma200: 100, histNow: 1 }).call, 'NO TRADE');
assert.strictEqual(d({ score: 25, price: 90, sma200: 100, histNow: -1, fundingPct: 50 }).call, 'SHORT WATCH');
assert.strictEqual(d({ score: 25, price: 90, sma200: 100, histNow: -1, fundingPct: 5 }).call, 'NO TRADE'); // funding extremely negative
assert.strictEqual(d({ score: 35, price: 110, sma200: 100, histNow: 1 }).exit, true);
assert.strictEqual(d({ score: 60, price: 110, sma200: 100, histNow: -1 }).exit, true);

// --- modes: 200-day scoring ---
assert.strictEqual(I.scoreTrend(90, 100, 'dip'), 100); assert.strictEqual(I.scoreTrend(110, 100, 'dip'), 0);
assert.strictEqual(I.scoreTrend(90, 100, 'hybrid'), 90); assert.strictEqual(I.scoreTrend(110, 100, 'hybrid'), 60);
assert.strictEqual(I.scoreTrend(125, 100, 'hybrid'), 30); assert.strictEqual(I.scoreTrend(140, 100, 'hybrid'), 0);

// --- modes: decisions ---
assert.strictEqual(d({ mode: 'dip', score: 72, price: 90, sma200: 100, histNow: -1 }).call, 'FULL LONG');
assert.strictEqual(d({ mode: 'dip', score: 72, price: 110, sma200: 100, histNow: 1 }).call, 'NO TRADE');
assert.strictEqual(d({ mode: 'dip', score: 72, price: 110, sma200: 100 }).exit, true);
const hy = { mode: 'hybrid', score: 60, price: 90, sma200: 100, histNow: -2, histPrev: -3, rsi: 35, fg: 50 };
assert.strictEqual(d(hy).call, 'HALF SIZE');                                   // below + turning + oversold
assert.strictEqual(d({ ...hy, histPrev: -1 }).call, 'NO TRADE');               // MACD still falling
assert.strictEqual(d({ ...hy, rsi: 50, fg: 50 }).call, 'NO TRADE');            // no washout
assert.strictEqual(d({ ...hy, rsi: 50, fg: 20 }).call, 'HALF SIZE');           // fear confirms instead
assert.strictEqual(d({ mode: 'hybrid', score: 60, price: 131, sma200: 100 }).exit, true);  // stretched
assert.strictEqual(d({ mode: 'hybrid', score: 60, price: 120, sma200: 100 }).exit, false);
assert.notStrictEqual(d({ mode: 'dip', score: 20, price: 90, sma200: 100, histNow: -1, fundingPct: 50 }).call, 'SHORT WATCH');

// --- flash crash detector (hourly candles) ---
const H = 3600e3, now = 1000 * H;
const mkHourly = (path) => path.map((p, i) => ({ t: now - (path.length - 1 - i) * H, o: p, h: p * 1.002, l: p * 0.998, c: p }));
const flatThenCrash = [...Array(30).fill(100000), 96000, 90000, 85000, 86000]; // −15% in 3h
let fc = I.detectFlashCrash(mkHourly(flatThenCrash), 86000, 3000, now);
assert.strictEqual(fc.state, 'crashing', 'bounce < 5% → wait');
fc = I.detectFlashCrash(mkHourly([...flatThenCrash, 90000]), 90000, 3000, now);
assert.strictEqual(fc.state, 'buy', 'bounced ≥5% → buy');
assert.ok(fc.stop < fc.low, 'stop under crash low');
const slowGrind = Array.from({ length: 30 }, (_, i) => 100000 - i * 150);       // −4.4% over 30h
assert.strictEqual(I.detectFlashCrash(mkHourly(slowGrind), slowGrind.at(-1), 3000, now).state, 'none', 'slow decline ignored');
const bigButNormal = [...Array(30).fill(100000), 89000, 92000];              // −11% but ATR huge
assert.strictEqual(I.detectFlashCrash(mkHourly(bigButNormal), 92000, 6000, now).state, 'none', 'drop < 2.5×ATR ignored');
const old = mkHourly(flatThenCrash).map(c => ({ ...c, t: c.t - 72 * H }));   // crash 3 days ago
assert.strictEqual(I.detectFlashCrash([...old, ...mkHourly([90000])], 90000, 3000, now).state, 'none', 'expires after 48h');

// --- v3 regime model ---
{
  const mk = (startISO, nDays, f) => Array.from({ length: nDays }, (_, i) => { const c = f(i); return { t: Date.parse(startISO) + i * 864e5, o: c, h: c * 1.01, l: c * 0.99, c }; });
  // Steady uptrend ending ~906 days after the 2024 halving (outside caution window) → HOLD
  const up = I.regime(mk('2022-04-01', 1650, i => 20000 * Math.pow(1.0012, i)));
  assert.strictEqual(up.votes.trend, 1); assert.strictEqual(up.votes.wmacd, 1); assert.strictEqual(up.votes.cycle, 1);
  assert.strictEqual(up.inMkt, true, 'uptrend outside caution window = hold');
  // Same uptrend but ending inside the caution window (~600 days after 2024 halving) → cycle votes −1
  const caut = I.regime(mk('2021-08-01', 1600, i => 20000 * Math.pow(1.0012, i)));
  assert.ok(caut.daysSinceHalving >= 450 && caut.daysSinceHalving <= 830); assert.strictEqual(caut.votes.cycle, -1);
  // Downtrend: trend −1, weekly MACD −1 → cash
  const down = I.regime(mk('2021-08-01', 1600, i => 90000 * Math.pow(0.9992, i)));
  assert.strictEqual(down.votes.trend, -1); assert.strictEqual(down.inMkt, false);
  // Washed-out bottom via 200-week value passed in (short history)
  const short = I.regime(mk('2026-01-01', 300, i => 60000 - i * 50), { ma200wNow: 80000 });
  assert.strictEqual(short.votes.bottom, 1, 'below 200-week = bottom vote');
  // Pi Cycle: parabolic blow-off triggers the top cross → −1
  const para = I.regime(mk('2019-01-01', 1200, i => i < 900 ? 4000 * Math.pow(1.001, i) : 4000 * Math.pow(1.001, 900) * Math.pow(1.02, i - 900)));
  const k = para.series.t.indexOf(para.lastPiCross);
  assert.ok(k > 900, 'Pi Cycle top fires on blow-off');
  assert.strictEqual(para.series.sig.pi[k + 100], -1, 'bearish for 180 days after cross');
  assert.strictEqual(para.series.sig.pi[k + 181], 0, 'expires after 180 days');
  // Weights: trend & Pi count double; score = weighted votes / 7
  assert.deepStrictEqual(I.V3.weights, { trend: 2, pi: 2, wmacd: 1, cycle: 1, bottom: 1 });
}

// --- full evaluate on synthetic uptrend ---
const day = 86400000;
const daily = Array.from({ length: 300 }, (_, i) => { const c = 20000 + i * 100 + Math.sin(i / 5) * 300; return { t: i * day, o: c, h: c + 200, l: c - 200, c }; });
const fundingHourly = Array.from({ length: 180 * 24 }, (_, i) => ({ t: (120 * day) + i * 3600000, rate: 0.00001 + 0.000005 * Math.sin(i / 50) }));
const oiDaily = Array.from({ length: 30 }, (_, i) => ({ t: i * day, oi: 2000 }));
const ev = I.evaluate({ daily, fundingHourly, oiDaily, fg: 40 });
assert.ok(ev.score >= 0 && ev.score <= 100, 'score in range');
assert.strictEqual(ev.scores.trend, 100, 'uptrend above 200d');
assert.ok(ev.risk && ev.risk.hardStop < ev.price, 'stop below price');
for (const k of Object.keys(I.WEIGHTS)) assert.ok(ev.scores[k] != null, `factor ${k} present`);
console.log('all indicator tests passed; sample score', ev.score, ev.decision.call);
