/* Renderer v3: weighted regime model (hold BTC vs cash) + context. */
const $ = (id) => document.getElementById(id);
const usd = (n, d = 0) => n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (n, d = 1) => n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(d)}%`;
const dateStr = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DAY = 86400000;

const state = {
  settings: null, tick: 0, pinned: true,
  ticker: null, daily: null, weekly: null, hourly: null, fg: null, fgLabel: null, funding: [], oi: [], fundingLive: null,
  lastCall: null
};

// ---------- data (all free, US-accessible) ----------
const J = (url) => window.api.fetchJson(url);
const krakenRows = (j) => j.result[Object.keys(j.result).find(k => k !== 'last')];
const toCandles = (rows) => rows.map(r => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));

async function fetchTicker() {
  const j = await J('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
  const t = j.result[Object.keys(j.result)[0]];
  state.ticker = { price: +t.c[0], open24: +t.o };
}
async function fetchDaily() { state.daily = toCandles(krakenRows(await J('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440'))); }
async function fetchWeekly() { state.weekly = toCandles(krakenRows(await J('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080'))); }
async function fetchHourly() { state.hourly = toCandles(krakenRows(await J('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60'))); }
async function fetchFearGreed() {
  const d = (await J('https://api.alternative.me/fng/?limit=1')).data[0];
  state.fg = +d.value; state.fgLabel = d.value_classification;
}
async function fetchFunding() {
  const j = await J('https://futures.kraken.com/derivatives/api/v4/historicalfundingrates?symbol=PF_XBTUSD');
  state.funding = (j.rates || []).map(r => ({ t: Date.parse(r.timestamp), rate: +r.relativeFundingRate })).filter(r => isFinite(r.rate)).slice(-180 * 24);
  try {
    const tk = (await J('https://futures.kraken.com/derivatives/api/v3/tickers/PF_XBTUSD')).ticker;
    if (tk && isFinite(+tk.relativeFundingRate)) state.fundingLive = { t: Date.now(), rate: +tk.relativeFundingRate };
  } catch {}
}
async function fetchOI() {
  const since = Math.floor(Date.now() / 1000) - 40 * 86400;
  const r = (await J(`https://futures.kraken.com/api/charts/v1/analytics/PF_XBTUSD/open-interest?interval=86400&since=${since}`)).result || {};
  state.oi = (r.timestamp || []).map((t, i) => ({ t: t * 1000, oi: +(r.data[i][3]) })).filter(x => isFinite(x.oi));
}

// ---------- model ----------
function ma200w() {
  const w = state.weekly; if (!w || w.length < 200) return null;
  return w.slice(-200).reduce((s, x) => s + x.c, 0) / 200;
}
function compute() {
  if (!state.daily || state.daily.length < 400) return null;
  const now = Date.now();
  // Official: completed daily candles only (exactly how the model was tested)
  const done = state.daily.filter(d => d.t + DAY <= now);
  const official = Indicators.regime(done, { ma200wNow: ma200w() });
  // Preview: as if today closed at the live price
  let preview = null;
  const forming = state.daily.find(d => d.t + DAY > now);
  if (forming && state.ticker) preview = Indicators.regime([...done, { ...forming, c: state.ticker.price }], { ma200wNow: ma200w() });
  return { official, preview };
}

// ---------- charts ----------
function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function priceChart(canvas, r, w200) {
  const s = setupCanvas(canvas); if (!s) return; const { ctx, w, h } = s;
  const N = Math.min(r.series.c.length, 600), off = r.series.c.length - N;
  const c = r.series.c.slice(off), m = r.series.s200.slice(off), inm = r.series.inMkt.slice(off);
  const vals = [...c, ...m.filter(v => v != null), ...(w200 ? [w200] : [])];
  const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.02;
  const x = i => 2 + i / (N - 1) * (w - 4), y = v => h - 3 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (h - 6);
  // background bands for in-market
  for (let i = 0; i < N; i++) if (inm[i]) { ctx.fillStyle = 'rgba(34,197,94,.07)'; ctx.fillRect(x(i) - (w / N) / 2, 0, w / N + 0.5, h); }
  if (w200) { ctx.strokeStyle = '#a78bfa'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y(w200)); ctx.lineTo(w, y(w200)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = '#f7931a'; ctx.lineWidth = 1.3; ctx.beginPath(); let st = false;
  m.forEach((v, i) => { if (v == null) return; st ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)); st = true; }); ctx.stroke();
  ctx.lineWidth = 1.6;
  for (let i = 1; i < N; i++) { ctx.strokeStyle = inm[i] ? '#22c55e' : '#64748b'; ctx.beginPath(); ctx.moveTo(x(i - 1), y(c[i - 1])); ctx.lineTo(x(i), y(c[i])); ctx.stroke(); }
}
function barChart(canvas, bars) {
  const s = setupCanvas(canvas); if (!s) return; const { ctx, w, h } = s;
  const v = bars.filter(b => b != null); if (v.length < 2) return;
  const mx = Math.max(...v.map(Math.abs)) || 1, y0 = h / 2, bw = Math.max(1, w / bars.length * 0.7);
  ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
  bars.forEach((b, i) => { if (b == null) return; const xi = 2 + i / (bars.length - 1) * (w - 4); const hh = b / mx * (h / 2 - 2); ctx.fillStyle = b >= 0 ? '#22c55e' : '#ef4444'; ctx.fillRect(xi - bw / 2, b >= 0 ? y0 - hh : y0, bw, Math.max(1, Math.abs(hh))); });
}

// ---------- signal text ----------
function sigText(k, r) {
  switch (k) {
    case 'trend': return r.votes.trend > 0 ? `Uptrend · price ${pct(r.price / r.sma200 - 1, 0)} vs 200-day` : `Downtrend · price ${pct(r.price / r.sma200 - 1, 0)} vs 200-day`;
    case 'pi': return r.piActive ? `Top signal fired ${dateStr(r.lastPiCross + DAY)} — stand aside 180 days` : `No top signal · gauge at ${Math.round((r.piRatio || 0) * 100)}%`;
    case 'wmacd': return r.wHist > 0 ? 'Weekly momentum positive' : 'Weekly momentum negative';
    case 'cycle': return r.votes.cycle < 0 ? `Day ${Math.round(r.daysSinceHalving)} — inside caution window (450–830)` : `Day ${Math.round(r.daysSinceHalving)} — outside caution window`;
    case 'bottom': return r.votes.bottom > 0 ? 'Washed out — below 200-week avg or deep under 200-day' : 'Not washed out';
  }
}
const pill = (v) => v > 0 ? ['bull', 'BULLISH'] : v < 0 ? ['bear', 'BEARISH'] : ['flat', 'NEUTRAL'];

// ---------- render ----------
function render() {
  const out = compute(); if (!out) return;
  const r = out.official, p = out.preview;
  const W = Indicators.V3.weights, wSum = Object.values(W).reduce((s, v) => s + v, 0);
  const pts = Math.round(r.score * wSum);

  // header
  const call = r.inMkt ? 'HOLD BTC' : 'IN CASH';
  $('signal').className = `signal ${r.inMkt ? 'hold' : 'cash'}`;
  $('call').textContent = call;
  $('since').textContent = `since ${dateStr(r.since + DAY)} (${r.sinceDays} days) · last close ${usd(r.price)}`;
  $('votes').textContent = `${pts >= 0 ? '+' : ''}${pts} / ${wSum}`;
  if (p && p.inMkt !== r.inMkt) { $('preview').textContent = `If today closed now: switch to ${p.inMkt ? 'HOLD BTC' : 'CASH'}`; $('preview').classList.remove('hidden'); }
  else $('preview').classList.add('hidden');
  if (state.lastCall && state.lastCall !== call) flash($('signal'));
  state.lastCall = call;

  // signals
  $('sigs').innerHTML = Object.keys(W).map(k => {
    const [cls, txt] = pill(r.votes[k]);
    return `<div class="sigrow"><span class="nm">${Indicators.V3_LABELS[k]}<small>×${W[k]}</small></span><span class="pill ${cls}">${txt}</span><span class="st">${sigText(k, r)}</span></div>`;
  }).join('');

  // price
  const t = state.ticker, live = t ? t.price : r.price, w200 = r.ma200w ?? ma200w();
  $('price').textContent = usd(live);
  if (t) { const chg = (t.price - t.open24) / t.open24; $('chg').textContent = `${pct(chg, 2)} 24h`; $('chg').className = `chg ${chg >= 0 ? 'up' : 'down'}`; }
  $('sma').textContent = usd(r.sma200);
  $('w200').textContent = usd(w200);
  $('mayer').textContent = r.mayer ? r.mayer.toFixed(2) + '×' : '—';
  const tag = $('trend-tag'); const up = live > r.sma200;
  tag.textContent = up ? 'ABOVE 200D' : 'BELOW 200D'; tag.className = `tag ${up ? 'up' : 'down'}`;
  priceChart($('price-chart'), r, w200);

  // cycle clock (0–1460 days)
  const d = r.daysSinceHalving, [a, b] = Indicators.V3.cycleWindow, span = 1460;
  $('hdays').textContent = Math.round(d);
  $('zone').style.left = `${a / span * 100}%`; $('zone').style.width = `${(b - a) / span * 100}%`;
  $('needle').style.left = `calc(${Math.min(d, span) / span * 100}% - 1px)`;
  const lastH = Indicators.HALVINGS.filter(x => x <= r.series.t.at(-1)).at(-1);
  const zoneTxt = `Caution window ${dateStr(lastH + a * DAY)} – ${dateStr(lastH + b * DAY)}`;
  $('clock-note').textContent = r.nextHalving ? `${zoneTxt} · next halving ≈ ${dateStr(r.nextHalving)}` : zoneTxt;
  // Pi gauge
  const pr = r.piRatio || 0;
  $('pi').textContent = r.piActive ? 'FIRED' : `${Math.round(pr * 100)}%`;
  $('pi').style.color = r.piActive ? '#ef4444' : pr > 0.85 ? '#eab308' : '';
  $('pi-bar').style.width = `${Math.min(pr, 1) * 100}%`;
  $('pi-bar').style.background = pr >= 1 ? '#ef4444' : pr > 0.85 ? '#eab308' : '#22c55e';
  // weekly MACD (one bar per completed week)
  const wk = []; r.series.t.forEach((tt, i) => { if (new Date(tt).getUTCDay() === 0) wk.push(r.series.wHist[i]); });
  $('wh').textContent = r.wHist != null ? `${r.wHist >= 0 ? '+' : ''}${Math.round(r.wHist).toLocaleString('en-US')}` : '—';
  $('wh').style.color = r.wHist > 0 ? '#22c55e' : '#ef4444';
  barChart($('wmacd-chart'), wk.slice(-60));

  // context
  if (state.fg != null) {
    $('fg-val').textContent = state.fg; $('fg-label').textContent = state.fgLabel;
    $('fg-val').style.color = state.fg < 25 ? '#22c55e' : state.fg > 75 ? '#ef4444' : '';
    $('fg-bar').style.left = `calc(${state.fg}% - 1px)`;
  }
  const funding = state.fundingLive ? [...state.funding, state.fundingLive] : state.funding;
  if (funding.length) {
    const now = funding.at(-1).rate, hist = funding.map(f => f.rate);
    const rank = Indicators.pctRank(hist, now);
    $('fund-val').textContent = `${(now * 100).toFixed(4)}%`;
    $('fund-val').style.color = now <= 0 ? '#22c55e' : rank > 80 ? '#ef4444' : '';
    $('fund-pct').textContent = `higher than ${Math.round(rank)}% of last 6 mo`;
  }
  if (state.oi.length >= 8) {
    const ch = state.oi.at(-1).oi / state.oi.at(-8).oi - 1;
    $('oi-val').textContent = pct(ch);
    $('oi-note').textContent = ch > 0.05 ? 'leverage building' : ch < -0.02 ? 'leverage unwinding' : 'stable';
  }
  if (state.hourly && state.daily) {
    const atr = Indicators.atr(state.daily, 14).at(-2);
    const fc = Indicators.detectFlashCrash(state.hourly, live, atr, Date.now());
    const v = $('crash-val'), n = $('crash-note');
    if (fc.state === 'buy') { v.textContent = 'BOUNCE'; v.style.color = '#c084fc'; n.textContent = `down ${(fc.dropPct * 100).toFixed(0)}%, bounced 5% — stop ${usd(fc.stop)}`; }
    else if (fc.state === 'crashing') { v.textContent = 'CRASHING'; v.style.color = '#a855f7'; n.textContent = `down ${(fc.dropPct * 100).toFixed(0)}% — wait for ${usd(fc.bounceFrom)}`; }
    else { v.textContent = 'Calm'; v.style.color = ''; n.textContent = 'no 10%+ drop in 24h'; }
  }

  $('updated').textContent = new Date().toLocaleTimeString();
}
function flash(el) { el.style.filter = 'brightness(1.7)'; setTimeout(() => el.style.filter = '', 700); }

// ---------- loop ----------
async function tick() {
  const k = state.tick++;
  const jobs = [fetchTicker()];
  if (k % 12 === 0) jobs.push(fetchDaily(), fetchHourly(), fetchFearGreed());   // ~1 min at 5 s
  if (k % 60 === 0) jobs.push(fetchWeekly(), fetchFunding(), fetchOI());        // ~5 min
  const res = await Promise.allSettled(jobs);
  res.filter(x => x.status === 'rejected').forEach(x => console.warn(x.reason));
  try { render(); } catch (e) { console.error(e); }
}
let timer;
function startLoop() { clearInterval(timer); tick(); timer = setInterval(tick, Math.max(2000, state.settings.refreshMs || 5000)); }

// ---------- UI ----------
function setMax(panel) {
  const grid = $('grid'), already = panel && panel.classList.contains('maxed');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('maxed'));
  if (panel && !already) { panel.classList.add('maxed'); grid.classList.add('has-max'); } else grid.classList.remove('has-max');
  document.querySelectorAll('button.max').forEach(b => b.textContent = b.closest('.panel').classList.contains('maxed') ? '⤡' : '⤢');
  requestAnimationFrame(() => { try { render(); } catch {} });
}
function wireUi() {
  $('close').onclick = () => window.api.close();
  $('min').onclick = () => window.api.minimize();
  $('pin').onclick = () => { state.pinned = !state.pinned; window.api.togglePin(state.pinned); $('pin').classList.toggle('on', state.pinned); };
  $('full').onclick = async () => { const on = await window.api.toggleFullscreen(); $('full').classList.toggle('on', on); };
  document.querySelectorAll('button.max').forEach(b => b.onclick = () => setMax(b.closest('.panel')));
  document.querySelectorAll('.panel h2').forEach(h => h.ondblclick = () => setMax(h.closest('.panel')));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('grid').classList.contains('has-max')) setMax(null); else { window.api.exitFullscreen(); $('full').classList.remove('on'); }
  });
  $('gear').onclick = () => {
    $('s-refresh').value = (state.settings.refreshMs || 5000) / 1000;
    $('s-opacity').value = state.settings.opacity ?? 1;
    $('settings').classList.remove('hidden');
  };
  $('s-cancel').onclick = () => $('settings').classList.add('hidden');
  $('s-opacity').oninput = (e) => window.api.setSettings({ opacity: Number(e.target.value) });
  $('s-save').onclick = async () => {
    state.settings = await window.api.setSettings({ refreshMs: Number($('s-refresh').value) * 1000, opacity: Number($('s-opacity').value) });
    $('settings').classList.add('hidden'); startLoop();
  };
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { try { render(); } catch {} }, 80); });
}

(async function init() {
  state.settings = await window.api.getSettings();
  wireUi();
  startLoop();
})();
