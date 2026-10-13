// Pure functions: indicators, factor scoring, composite, decision.
// Shared by the widget (browser) and the tests/backtest (Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Indicators = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const last = (a, k = 1) => a[a.length - k];

  // ---------- indicators (arrays oldest -> newest, null where undefined) ----------
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    const start = values.findIndex(v => v != null);
    if (start < 0 || values.length - start < period) return out;
    let s = 0;
    for (let i = start; i < start + period; i++) s += values[i];
    out[start + period - 1] = s / period;
    for (let i = start + period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
    return out;
  }

  // Wilder RSI
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= period; l /= period;
    out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      g = (g * (period - 1) + Math.max(d, 0)) / period;
      l = (l * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  function macd(closes, fast = 12, slow = 26, sig = 9) {
    const ef = ema(closes, fast), es = ema(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
    const signal = ema(line, sig);
    const hist = line.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
    return { macd: line, signal, hist };
  }

  // Wilder ATR. candles: [{h,l,c}]
  function atr(candles, period = 14) {
    const out = new Array(candles.length).fill(null);
    const tr = candles.map((c, i) => i === 0 ? c.h - c.l
      : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c)));
    if (candles.length <= period) return out;
    let a = 0; for (let i = 1; i <= period; i++) a += tr[i]; a /= period;
    out[period] = a;
    for (let i = period + 1; i < candles.length; i++) { a = (a * (period - 1) + tr[i]) / period; out[i] = a; }
    return out;
  }

  // Percentile rank (0-100) of x within arr
  function pctRank(arr, x) {
    const v = arr.filter(n => n != null && isFinite(n));
    if (!v.length || x == null) return null;
    const below = v.filter(n => n < x).length, eq = v.filter(n => n === x).length;
    return 100 * (below + 0.5 * eq) / v.length;
  }

  // ---------- factor scores (0-100, 100 = most bullish) ----------
  const WEIGHTS = { trend: 0.25, macd: 0.20, rsi: 0.15, funding: 0.15, positioning: 0.15, fearGreed: 0.10 };

  // Three ways to read the 200-day average:
  //   trend  – buy strength: above → 100, mildly below (≤3%) → 30, else 0
  //   dip    – buy weakness: below → 100, above → 0
  //   hybrid – cheaper is better, stretched is bad: below → 90, 0–15% above → 60, 15–30% → 30, >30% → 0
  const MODES = ['trend', 'dip', 'hybrid'];
  const MODE_LABELS = { trend: 'Trend-following', dip: 'Dip-buy', hybrid: 'Middle ground' };
  const STRETCH = 0.30; // hybrid: "well above" = 30% over the 200-day

  function scoreTrend(price, sma200, mode = 'trend') {
    if (price == null || sma200 == null) return null;
    const gap = (price - sma200) / sma200;
    if (mode === 'dip') return gap < 0 ? 100 : 0;
    if (mode === 'hybrid') return gap < 0 ? 90 : gap <= 0.15 ? 60 : gap <= STRETCH ? 30 : 0;
    if (gap >= 0) return 100;
    return -gap <= 0.03 ? 30 : 0;
  }

  // Histogram positive & expanding → 90; positive → 70; negative but rising → 35; negative & falling → 10.
  function scoreMacd(histNow, histPrev) {
    if (histNow == null || histPrev == null) return null;
    if (histNow > 0) return histNow > histPrev ? 90 : 70;
    return histNow > histPrev ? 35 : 10;
  }

  // <30 → 95 (oversold bounce); 30-40 → 70; 40-60 → 85 in uptrend else 50; 60-70 → 50; >70 → 15.
  function scoreRsi(r, uptrend) {
    if (r == null) return null;
    if (r < 30) return 95;
    if (r < 40) return 70;
    if (r <= 60) return uptrend ? 85 : 50;
    if (r <= 70) return 50;
    return 15;
  }

  // Funding + OI. fundingPct = percentile of current funding vs trailing 180d; oiChg7 = 7-day OI change (fraction).
  function scoreFunding(funding, fundingPct, oiChg7) {
    if (funding == null || fundingPct == null) return null;
    let s = 100 - fundingPct;                  // cheap/negative funding = bullish
    if (funding <= 0) s = Math.max(s, 85);     // negative funding = shorts paying = bullish
    if (oiChg7 != null) {
      if (oiChg7 <= 0.02) s += 10;             // stable/falling OI: less leverage building
      else if (oiChg7 > 0.05 && fundingPct > 70) s -= 20; // crowded longs piling in
    }
    return clamp(Math.round(s));
  }

  // Positioning (stand-in for long/short ratio): 7-day avg funding percentile vs 180d, contrarian.
  // Bottom 25% → 90, top 25% → 15, linear between.
  function scorePositioning(avgFundingPct) {
    if (avgFundingPct == null) return null;
    if (avgFundingPct <= 25) return 90;
    if (avgFundingPct >= 75) return 15;
    return Math.round(90 - (avgFundingPct - 25) * (75 / 50));
  }

  // Extreme Fear (<25) high, Extreme Greed (>75) low.
  function scoreFearGreed(fg) {
    if (fg == null) return null;
    if (fg < 25) return 90;
    if (fg > 75) return 10;
    return Math.round(90 - (fg - 25) * (80 / 50));
  }

  // Weighted composite; missing factors are skipped and remaining weights renormalised.
  function composite(scores) {
    let sum = 0, w = 0;
    for (const [k, wt] of Object.entries(WEIGHTS)) {
      if (scores[k] == null) continue;
      sum += scores[k] * wt; w += wt;
    }
    return w ? Math.round(sum / w) : null;
  }

  // ---------- decision ----------
  // Entry gate per mode, then size by score (≥70 full, 55–69 half).
  //   trend  – price above 200-day AND MACD histogram positive. Exit: score < 40 or histogram ≤ 0.
  //   dip    – price below 200-day. Exit: price back above 200-day.
  //   hybrid – price below 200-day AND MACD histogram rising AND (RSI < 40 or Fear & Greed < 30).
  //            Exit: price ≥ 30% above 200-day, or score < 40.
  function decide({ mode = 'trend', score, price, sma200, histNow, histPrev, rsi: rsiNow, fg, fundingPct }) {
    const have = price != null && sma200 != null;
    const above = have && price > sma200;
    const below = have && price < sma200;
    const histPos = histNow != null && histNow > 0;
    const histRising = histNow != null && histPrev != null && histNow > histPrev;
    const washedOut = (rsiNow != null && rsiNow < 40) || (fg != null && fg < 30);
    const stretched = have && price >= sma200 * (1 + STRETCH);

    const reasons = [];
    let gate = false;
    if (mode === 'dip') {
      gate = below;
      if (!below) reasons.push('price above 200-day');
    } else if (mode === 'hybrid') {
      gate = below && histRising && washedOut;
      if (!below) reasons.push('price above 200-day');
      if (!histRising) reasons.push('MACD not turning up');
      if (!washedOut) reasons.push('no oversold / fear confirmation');
    } else {
      gate = above && histPos;
      if (!above) reasons.push('price below 200-day');
      if (!histPos) reasons.push('MACD histogram negative');
    }
    if (score != null && score < 55) reasons.push(`score ${score} < 55`);

    let call = 'NO TRADE', size = 0;
    if (score != null && gate && score >= 70) { call = 'FULL LONG'; size = 1; }
    else if (score != null && gate && score >= 55) { call = 'HALF SIZE'; size = 0.5; }
    else if (mode === 'trend' && score != null && score <= 30 && below && !(fundingPct != null && fundingPct < 10)) call = 'SHORT WATCH';

    let exit;
    if (mode === 'dip') exit = above;
    else if (mode === 'hybrid') exit = stretched || (score != null && score < 40);
    else exit = (score != null && score < 40) || (histNow != null && histNow <= 0);

    return { mode, call, size, exit, above, histPos, histRising, reasons };
  }

  // ---------- flash crash detector ----------
  // Works on any candle series (hourly live, daily in backtests).
  // A crash = within `windowMs`, price fell ≥ `drop` from a high to a later low AND that fall ≥ `atrMult` × daily ATR.
  // State: 'none' | 'crashing' (no bounce yet – wait) | 'buy' (bounced ≥ `bounce` off the low, within `validMs`).
  // Defaults chosen on 2015–2020 data and confirmed on 2021–2026 (see backtest/): 5% bounce, stop 1.5×ATR under the low.
  const CRASH_DEFAULTS = { drop: 0.10, atrMult: 2.5, bounce: 0.05, windowMs: 24 * 3600e3, validMs: 48 * 3600e3, stopAtr: 1.5 };

  function detectFlashCrash(candles, price, dailyAtr, now, opts = {}) {
    const o = { ...CRASH_DEFAULTS, ...opts };
    if (!candles || candles.length < 2 || price == null || dailyAtr == null) return { state: 'none' };
    const recent = candles.filter(c => c.t >= now - o.validMs - o.windowMs);
    // Find the deepest low in the valid window, then the highest high in the 24h before it.
    let best = null;
    for (let i = 0; i < recent.length; i++) {
      const lowC = recent[i];
      if (lowC.t < now - o.validMs) continue;
      let hi = -Infinity, hiT = null;
      for (let j = 0; j <= i; j++) {
        if (recent[j].t >= lowC.t - o.windowMs && recent[j].h > hi) { hi = recent[j].h; hiT = recent[j].t; }
      }
      const fall = hi - lowC.l, pct = fall / hi;
      if (pct >= o.drop && fall >= o.atrMult * dailyAtr && (!best || pct > best.pct)) best = { high: hi, highT: hiT, low: lowC.l, lowT: lowC.t, pct, fall };
    }
    if (!best) return { state: 'none' };
    // Low can only get lower while still crashing – use the lowest low since the crash low.
    const after = candles.filter(c => c.t >= best.lowT);
    const low = Math.min(best.low, ...after.map(c => c.l), price);
    const bounced = price >= low * (1 + o.bounce);
    return {
      state: bounced ? 'buy' : 'crashing',
      dropPct: (best.high - low) / best.high, high: best.high, low, lowT: best.lowT,
      bounceFrom: low * (1 + o.bounce),
      stop: low - o.stopAtr * dailyAtr,
      expires: best.lowT + o.validMs
    };
  }

  // ---------- v3 regime model (tested: train 2014–19, test 2020–2026) ----------
  // Stay in BTC when the weighted vote is > 0, otherwise cash. Evaluated on COMPLETED daily closes.
  const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-15'].map(Date.parse); // 2028 = estimate
  const V3 = {
    weights: { trend: 2, pi: 2, wmacd: 1, cycle: 1, bottom: 1 },
    cycleWindow: [450, 830],   // caution window, days after halving (learned from 2012 + 2016 cycles only)
    trendBuffer: 0.05,         // 200-day trend flips only when price is 5% beyond it
    mayerBottom: 0.8,          // price / 200-day below this = washed out
    piHoldDays: 180            // after a Pi Cycle top cross, bearish for 180 days
  };
  const V3_LABELS = { trend: '200-day trend', pi: 'Pi Cycle top', wmacd: 'Weekly MACD', cycle: 'Halving cycle', bottom: 'Washed-out bottom' };

  // daily: [{t,o,h,l,c}] completed candles, oldest → newest. ma200wNow: 200-week average for the last day
  // when daily history is too short to compute it (live widget gets it from weekly candles).
  function regime(daily, { ma200wNow = null } = {}) {
    const c = daily.map(d => d.c), T = daily.map(d => d.t), n = c.length;
    const s200 = sma(c, 200), s111 = sma(c, 111), s350 = sma(c, 350), s1400 = sma(c, 1400);
    const wkIdx = []; for (let i = 0; i < n; i++) if (new Date(T[i]).getUTCDay() === 0) wkIdx.push(i);  // Sunday candle = week close
    const wm = macd(wkIdx.map(i => c[i]));
    const wHist = new Array(n).fill(null);
    { let k = -1; for (let i = 0; i < n; i++) { while (k + 1 < wkIdx.length && wkIdx[k + 1] <= i) k++; if (k >= 0) wHist[i] = wm.hist[k]; } }
    const W = V3.weights, wSum = Object.values(W).reduce((s, v) => s + v, 0);
    const sig = { trend: [], pi: [], wmacd: [], cycle: [], bottom: [] }, score = [], inMkt = [], days = [], ma200w = [];
    let trendOn = true, piOff = -1, lastPiCross = null;
    for (let i = 0; i < n; i++) {
      const h = HALVINGS.filter(x => x <= T[i]).at(-1);
      const d = h != null ? (T[i] - h) / 86400000 : null; days[i] = d;
      sig.cycle[i] = d == null ? 0 : (d >= V3.cycleWindow[0] && d <= V3.cycleWindow[1] ? -1 : 1);
      if (s200[i]) { if (c[i] > s200[i] * (1 + V3.trendBuffer)) trendOn = true; else if (c[i] < s200[i] * (1 - V3.trendBuffer)) trendOn = false; }
      sig.trend[i] = s200[i] ? (trendOn ? 1 : -1) : 0;
      sig.wmacd[i] = wHist[i] == null ? 0 : wHist[i] > 0 ? 1 : -1;
      if (i && s111[i] && s350[i] && s111[i] > 2 * s350[i] && s111[i - 1] <= 2 * s350[i - 1]) { piOff = i + V3.piHoldDays; lastPiCross = T[i]; }
      sig.pi[i] = i <= piOff ? -1 : 0;
      const mayer = s200[i] ? c[i] / s200[i] : null;
      ma200w[i] = s1400[i] ?? (i === n - 1 ? ma200wNow : null);
      sig.bottom[i] = (ma200w[i] && c[i] < ma200w[i]) || (mayer != null && mayer < V3.mayerBottom) ? 1 : 0;
      let s = 0; for (const k of Object.keys(W)) s += W[k] * sig[k][i];
      score[i] = s / wSum; inMkt[i] = score[i] > 0;
    }
    const i = n - 1;
    let since = i; while (since > 0 && inMkt[since - 1] === inMkt[i]) since--;
    const nextHalving = HALVINGS.find(x => x > T[i]) ?? null;
    return {
      inMkt: inMkt[i], score: score[i], votes: Object.fromEntries(Object.keys(W).map(k => [k, sig[k][i]])),
      since: T[since], sinceDays: Math.round((T[i] - T[since]) / 86400000),
      price: c[i], sma200: s200[i], mayer: s200[i] ? c[i] / s200[i] : null, ma200w: ma200w[i],
      piRatio: s111[i] && s350[i] ? s111[i] / (2 * s350[i]) : null, piActive: i <= piOff, lastPiCross,
      wHist: wHist[i], daysSinceHalving: days[i], nextHalving,
      series: { t: T, c, s200, s111, s350, wHist, score, inMkt, sig, days }
    };
  }

  // ---------- full evaluation from raw series ----------
  // daily: [{t,o,h,l,c}] oldest->newest (last may be forming); fundingHourly: [{t, rate}] ; oiDaily: [{t, oi}] ; fg: number
  function evaluate({ daily, hourly = [], fundingHourly = [], oiDaily = [], fg = null, mode = 'trend', now = Date.now(), crashOpts = {} }) {
    const closes = daily.map(d => d.c);
    const n = closes.length;
    const price = last(closes);
    const sma200s = sma(closes, 200);
    const m = macd(closes);
    const r = rsi(closes, 14);
    const a = atr(daily, 14);
    const sma200 = last(sma200s), histNow = last(m.hist), histPrev = last(m.hist, 2), rsiNow = last(r), atrNow = last(a);

    // funding: daily averages over trailing 180d
    const dayMs = 86400000;
    const byDay = new Map();
    for (const f of fundingHourly) { const d = Math.floor(f.t / dayMs); const e = byDay.get(d) || [0, 0]; e[0] += f.rate; e[1]++; byDay.set(d, e); }
    const fDaily = [...byDay.entries()].sort((x, y) => x[0] - y[0]).map(([, e]) => e[0] / e[1]).slice(-180);
    const fundingNow = fundingHourly.length ? last(fundingHourly).rate : null;
    const fundingPct = fundingNow != null ? pctRank(fDaily, fundingNow) : null;
    const avg7 = fDaily.length >= 7 ? fDaily.slice(-7).reduce((s, v) => s + v, 0) / 7 : null;
    const avg7Series = fDaily.map((_, i) => i >= 6 ? fDaily.slice(i - 6, i + 1).reduce((s, v) => s + v, 0) / 7 : null).filter(v => v != null);
    const avgFundingPct = avg7 != null ? pctRank(avg7Series, avg7) : null;
    const oiChg7 = oiDaily.length >= 8 ? (last(oiDaily).oi - last(oiDaily, 8).oi) / last(oiDaily, 8).oi : null;

    const scores = {
      trend: scoreTrend(price, sma200, mode),
      macd: scoreMacd(histNow, histPrev),
      rsi: scoreRsi(rsiNow, sma200 != null && price > sma200),
      funding: scoreFunding(fundingNow, fundingPct, oiChg7),
      positioning: scorePositioning(avgFundingPct),
      fearGreed: scoreFearGreed(fg)
    };
    const score = composite(scores);
    const decision = decide({ mode, score, price, sma200, histNow, histPrev, rsi: rsiNow, fg, fundingPct });

    // Flash crash overrides the normal call in every mode.
    const crash = detectFlashCrash(hourly.length ? hourly : daily, price, atrNow, now, crashOpts);
    if (crash.state === 'buy' && decision.size < 0.5) {
      decision.call = 'FLASH CRASH BUY'; decision.size = 0.5; decision.exit = false;
      decision.reasons = [`down ${(crash.dropPct * 100).toFixed(0)}% then bounced — stop under the low`];
    } else if (crash.state === 'crashing') {
      decision.call = 'CRASH IN PROGRESS'; decision.size = 0;
      decision.reasons = [`down ${(crash.dropPct * 100).toFixed(0)}% — wait for a bounce above ${Math.round(crash.bounceFrom).toLocaleString('en-US')}`];
    }

    // risk levels
    const atrPctSeries = a.map((v, i) => v != null ? v / closes[i] : null).slice(-180);
    const atrPctNow = atrNow != null ? atrNow / price : null;
    const highVol = atrPctNow != null && pctRank(atrPctSeries, atrPctNow) >= 90;
    const risk = atrNow == null ? null : {
      atr: atrNow,
      hardStop: price - 1.75 * atrNow,
      trailDistance: 1.75 * atrNow,
      partialTarget: price * 1.10,
      highVol
    };

    return {
      price, sma200, rsi: rsiNow, histNow, histPrev, macdNow: last(m.macd), signalNow: last(m.signal),
      fundingNow, fundingPct, avgFundingPct, oiChg7, fg,
      scores, score, decision, risk, crash,
      series: { closes, sma200: sma200s, rsi: r, macd: m, n }
    };
  }

  return { sma, ema, rsi, macd, atr, pctRank, WEIGHTS, MODES, MODE_LABELS, STRETCH,
    scoreTrend, scoreMacd, scoreRsi, scoreFunding, scorePositioning, scoreFearGreed,
    composite, decide, evaluate, detectFlashCrash, CRASH_DEFAULTS,
    regime, V3, V3_LABELS, HALVINGS };
});
