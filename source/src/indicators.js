// Pure functions: indicators + signal rules. Shared by renderer and tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Indicators = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Wilder's RSI. closes: oldest -> newest. Returns array aligned to closes (null where undefined).
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let start = values.findIndex(v => v != null);
    if (start < 0 || values.length - start < period) return out;
    let sum = 0;
    for (let i = start; i < start + period; i++) sum += values[i];
    out[start + period - 1] = sum / period;
    for (let i = start + period; i < values.length; i++) {
      out[i] = values[i] * k + out[i - 1] * (1 - k);
    }
    return out;
  }

  // Returns { macd:[], signal:[], hist:[] } aligned to closes.
  function macd(closes, fast = 12, slow = 26, sig = 9) {
    const ef = ema(closes, fast), es = ema(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
    const signal = ema(line, sig);
    const hist = line.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
    return { macd: line, signal, hist };
  }

  // Aggregate daily candles [{t, o, h, l, c}] (oldest->newest, t = ms) into ISO weeks (Mon-Sun).
  function toWeekly(daily) {
    const weeks = [];
    let cur = null, curKey = null;
    for (const d of daily) {
      const dt = new Date(d.t);
      const day = (dt.getUTCDay() + 6) % 7; // Mon=0
      const monday = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - day));
      const key = monday.getTime();
      if (key !== curKey) {
        cur = { t: key, o: d.o, h: d.h, l: d.l, c: d.c };
        weeks.push(cur); curKey = key;
      } else {
        cur.h = Math.max(cur.h, d.h); cur.l = Math.min(cur.l, d.l); cur.c = d.c;
      }
    }
    return weeks;
  }

  // ---- James's rules ----
  // fg: 0-100. longUsd/shortUsd: liquidation exposure. rsiNow/rsiPrev, macdNow/macdPrev: weekly values.
  function evaluate({ fg, longUsd, shortUsd, rsiNow, rsiPrev, macdNow, macdPrev }) {
    const votes = {};

    votes.fearGreed = fg == null ? 'na' : fg < 30 ? 'buy' : fg > 70 ? 'sell' : 'neutral';

    if (longUsd == null || shortUsd == null) votes.liquidation = 'na';
    else if (shortUsd > 0 && longUsd / shortUsd >= 4) votes.liquidation = 'sell';   // longs 4x shorts
    else if (longUsd > 0 && shortUsd / longUsd >= 4) votes.liquidation = 'buy';     // shorts 4x longs
    else votes.liquidation = 'neutral';

    // RSI must be in an extreme zone AND moving the right way vs the previous weekly candle
    votes.rsi = (rsiNow == null || rsiPrev == null) ? 'na'
      : (rsiNow < 30 && rsiNow > rsiPrev) ? 'buy'
      : (rsiNow > 70 && rsiNow < rsiPrev) ? 'sell'
      : 'neutral';

    votes.macd = (macdNow == null || macdPrev == null) ? 'na'
      : macdNow > macdPrev ? 'buy' : macdNow < macdPrev ? 'sell' : 'neutral';

    const buys = Object.values(votes).filter(v => v === 'buy').length;
    const sells = Object.values(votes).filter(v => v === 'sell').length;
    let overall = 'hold';
    if (buys > sells) overall = 'buy';
    else if (sells > buys) overall = 'sell';
    return { votes, buys, sells, overall };
  }

  return { rsi, ema, macd, toWeekly, evaluate };
});
