// Verifies the widget's v3 engine (src/indicators.js → regime) reproduces the weighted-signal test.
// Usage: node backtest/v3-check.js <hourly.csv>
const B = require('./backtest.js');
const I = require('../src/indicators.js');
const DAY = 86400e3;
const daily = B.toDaily(B.loadHourly(process.argv[2]).filter(h => h.t >= Date.parse('2012-06-01')));
const r = I.regime(daily);
const { c, t, inMkt } = r.series;

function sim(from, to) {
  const a = t.findIndex(x => x >= Date.parse(from)), b = to ? t.findIndex(x => x >= Date.parse(to)) : c.length;
  let eq = 1, hold = 1, pk = 1, hpk = 1, mdd = 0, hmdd = 0, exp = 0, inm = 0, switches = 0;
  for (let i = a; i < b; i++) {
    if (i > a) { eq *= 1 + exp * (c[i] / c[i - 1] - 1); hold *= c[i] / c[i - 1]; }
    const want = inMkt[i] ? 1 : 0;
    if (want !== exp) { eq *= 1 - 0.001; exp = want; switches++; }
    pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); hpk = Math.max(hpk, hold); hmdd = Math.min(hmdd, hold / hpk - 1); inm += exp;
  }
  const yrs = (t[b - 1] - t[a]) / (365.25 * DAY);
  const p = v => `${(v * 100).toFixed(0)}%`;
  return `${from} → ${to || 'today'}: v3 ${p(Math.pow(eq, 1 / yrs) - 1)}/yr, worst ${p(mdd)}, in market ${p(inm / (b - a))}, ${switches} switches | hold ${p(Math.pow(hold, 1 / yrs) - 1)}/yr, worst ${p(hmdd)}`;
}
console.log(sim('2014-01-01', '2020-01-01'));
console.log(sim('2020-01-01'));
console.log(sim('2014-01-01'));
// switch log
const log = []; for (let i = 1; i < c.length; i++) if (inMkt[i] !== inMkt[i - 1] && t[i] >= Date.parse('2014-01-01')) log.push(`${new Date(t[i]).toISOString().slice(0, 10)} ${inMkt[i] ? 'BUY ' : 'SELL'} @ ${Math.round(c[i])}`);
console.log(`\nSwitches since 2014 (${log.length}):\n` + log.join('\n'));
console.log(`\nToday (${new Date(t.at(-1)).toISOString().slice(0, 10)}): ${r.inMkt ? 'HOLD BTC' : 'IN CASH'}, score ${r.score.toFixed(2)}, votes ${JSON.stringify(r.votes)}, since ${new Date(r.since).toISOString().slice(0, 10)}`);
