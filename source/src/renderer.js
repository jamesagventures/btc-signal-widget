/* Renderer: polls data sources, draws panels, evaluates signal. */
const $ = (id) => document.getElementById(id);
const fmtUsd = (n, d = 0) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d, minimumFractionDigits: d });
const fmtBig = (n) => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : fmtUsd(n);

const state = {
  settings: null,
  fg: null, fgLabel: null,
  price: null, open24: null, hi: null, lo: null, priceHist: [],
  weekly: null, rsiSeries: null, macdSeries: null,
  liqLong: null, liqShort: null, liqErr: null,
  tick: 0, pinned: true
};

// ---------- data sources ----------
async function fetchFearGreed() {
  const j = await window.api.fetchJson('https://api.alternative.me/fng/?limit=1');
  const d = j.data[0];
  state.fg = Number(d.value); state.fgLabel = d.value_classification;
}

async function fetchTicker() {
  const j = await window.api.fetchJson('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
  const t = j.result[Object.keys(j.result)[0]];
  state.price = Number(t.c[0]); state.open24 = Number(t.o); state.hi = Number(t.h[1]); state.lo = Number(t.l[1]);
  state.priceHist.push(state.price); if (state.priceHist.length > 240) state.priceHist.shift();
}

async function fetchWeekly() {
  // Kraken returns weekly OHLC (10080 min). Last row = current, still-forming week.
  const j = await window.api.fetchJson('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080');
  const rows = j.result[Object.keys(j.result).find(k => k !== 'last')];
  state.weekly = rows.map(r => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
  const closes = state.weekly.map(w => w.c);
  state.rsiSeries = Indicators.rsi(closes, 14);
  state.macdSeries = Indicators.macd(closes, 12, 26, 9);
}

async function fetchLiquidations() {
  const key = state.settings.coinglassKey;
  if (!key) { state.liqErr = 'Add a Coinglass API key in ⚙ to score longs vs shorts'; state.liqLong = state.liqShort = null; return; }
  const headers = { 'CG-API-KEY': key };
  const urls = [
    'https://open-api-v4.coinglass.com/api/futures/liquidation/aggregated-history?exchange_list=Binance,OKX,Bybit&symbol=BTC&interval=1d&limit=30',
    'https://open-api-v4.coinglass.com/api/futures/liquidation/coin-history?symbol=BTC&interval=1d&limit=30'
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const j = await window.api.fetchJson(u, headers);
      const rows = Array.isArray(j.data) ? j.data : (j.data?.list || []);
      if (!rows.length) throw new Error('empty');
      let L = 0, S = 0;
      for (const r of rows.slice(-30)) {
        for (const [k, v] of Object.entries(r)) {
          const kl = k.toLowerCase();
          if (kl.includes('long') && kl.includes('liquidation')) L += Number(v) || 0;
          if (kl.includes('short') && kl.includes('liquidation')) S += Number(v) || 0;
        }
      }
      state.liqLong = L; state.liqShort = S; state.liqErr = null;
      return;
    } catch (e) { lastErr = e; }
  }
  state.liqErr = `Coinglass: ${lastErr?.message || 'error'}`; state.liqLong = state.liqShort = null;
}

// ---------- drawing ----------
function drawLine(canvas, series, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const pts = series.map((v, i) => [i, v]).filter(p => p[1] != null);
  if (pts.length < 2) return;
  const vals = pts.map(p => p[1]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (opts.min != null) min = Math.min(min, opts.min); if (opts.max != null) max = Math.max(max, opts.max);
  if (max === min) { max += 1; min -= 1; }
  const x = (i) => ((i - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0])) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - min) / (max - min)) * (h - 6);
  // guide lines
  ctx.strokeStyle = '#1f2a37'; ctx.lineWidth = 1;
  for (const g of (opts.guides || [])) { if (g < min || g > max) continue; ctx.beginPath(); ctx.moveTo(0, y(g)); ctx.lineTo(w, y(g)); ctx.stroke(); }
  if (opts.zero && min < 0 && max > 0) { ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke(); }
  // histogram
  if (opts.hist) {
    const bw = Math.max(1, (w / pts.length) * 0.6);
    opts.hist.forEach((v, i) => { if (v == null) return; ctx.fillStyle = v >= 0 ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)'; const yy = y(0); ctx.fillRect(x(i) - bw / 2, Math.min(yy, y(v)), bw, Math.abs(yy - y(v))); });
  }
  // extra line
  if (opts.second) { ctx.strokeStyle = '#f7931a'; ctx.lineWidth = 1; ctx.beginPath(); let s = false; opts.second.forEach((v, i) => { if (v == null) return; s ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)); s = true; }); ctx.stroke(); }
  // main line
  const last = pts[pts.length - 1][1], prev = pts[pts.length - 2][1];
  ctx.strokeStyle = opts.color || (last >= prev ? '#22c55e' : '#ef4444'); ctx.lineWidth = 1.6;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(x(p[0]), y(p[1])) : ctx.moveTo(x(p[0]), y(p[1]))); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x(pts[pts.length - 1][0]), y(last), 2.5, 0, Math.PI * 2); ctx.fill();
}

function setVote(k, v) {
  document.querySelectorAll(`.vote[data-k="${k}"]`).forEach(el => { el.className = `vote ${v}`; el.textContent = v === 'na' ? 'n/a' : v; });
}

function render() {
  // Fear & Greed
  if (state.fg != null) {
    $('fg-val').textContent = state.fg; $('fg-label').textContent = state.fgLabel;
    $('fg-bar').style.left = `calc(${state.fg}% - 1px)`;
    $('fg-val').style.color = state.fg < 30 ? '#ef4444' : state.fg > 70 ? '#22c55e' : '#eab308';
  }
  // Price
  if (state.price != null) {
    $('price').textContent = fmtUsd(state.price);
    const chg = (state.price - state.open24) / state.open24 * 100;
    $('chg').textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`; $('chg').className = `chg ${chg >= 0 ? 'up' : 'down'}`;
    $('hi').textContent = fmtUsd(state.hi); $('lo').textContent = fmtUsd(state.lo);
    if (state.priceHist.length > 1) drawLine($('spark'), state.priceHist);
  }
  // Indicators (weekly)
  let rsiNow, rsiPrev, macdNow, macdPrev;
  if (state.rsiSeries) {
    const r = state.rsiSeries, m = state.macdSeries.macd;
    rsiNow = r[r.length - 1]; rsiPrev = r[r.length - 2]; macdNow = m[m.length - 1]; macdPrev = m[m.length - 2];
    $('rsi-val').textContent = rsiNow?.toFixed(1) ?? '—';
    $('rsi-dir').textContent = rsiNow > rsiPrev ? '▲' : rsiNow < rsiPrev ? '▼' : '•'; $('rsi-dir').className = `dir ${rsiNow > rsiPrev ? 'up' : 'down'}`;
    $('macd-val').textContent = macdNow?.toFixed(0) ?? '—';
    $('macd-dir').textContent = macdNow > macdPrev ? '▲' : macdNow < macdPrev ? '▼' : '•'; $('macd-dir').className = `dir ${macdNow > macdPrev ? 'up' : 'down'}`;
    const N = 60;
    drawLine($('rsi-chart'), r.slice(-N), { min: 0, max: 100, guides: [30, 70] });
    drawLine($('macd-chart'), m.slice(-N), { zero: true, second: state.macdSeries.signal.slice(-N), hist: state.macdSeries.hist.slice(-N) });
  }
  // Liquidations
  $('liq-long').textContent = fmtBig(state.liqLong); $('liq-short').textContent = fmtBig(state.liqShort);
  $('liq-ratio').textContent = (state.liqLong && state.liqShort) ? `${(state.liqLong / state.liqShort).toFixed(2)} L/S` : '—';
  $('liq-note').textContent = state.liqErr || 'longs ≥4× shorts → sell · shorts ≥4× longs → buy (30d realized liquidations)';

  // Signal
  const res = Indicators.evaluate({ fg: state.fg, longUsd: state.liqLong, shortUsd: state.liqShort, rsiNow, rsiPrev, macdNow, macdPrev });
  for (const [k, v] of Object.entries(res.votes)) setVote(k, v);
  const sig = $('signal'); sig.className = `signal ${res.overall}`;
  $('signal-text').textContent = res.overall.toUpperCase();
  $('signal-votes').textContent = `${res.buys} buy · ${res.sells} sell`;
  if (res.overall !== render.lastOverall && render.lastOverall) flash(sig);
  render.lastOverall = res.overall;
  $('updated').textContent = new Date().toLocaleTimeString();
}
function flash(el) { el.style.filter = 'brightness(1.8)'; setTimeout(() => el.style.filter = '', 600); }

// ---------- loop ----------
async function tick() {
  state.tick++;
  const jobs = [fetchTicker().catch(e => console.warn('ticker', e)), fetchFearGreed().catch(e => console.warn('fng', e))];
  if (state.tick % 12 === 1) jobs.push(fetchWeekly().catch(e => console.warn('weekly', e)));      // ~every minute at 5s
  if (state.tick % 12 === 1) jobs.push(fetchLiquidations().catch(e => console.warn('liq', e)));
  await Promise.all(jobs);
  render();
}
let timer;
function startLoop() { clearInterval(timer); tick(); timer = setInterval(tick, Math.max(2000, state.settings.refreshMs || 5000)); }

// ---------- UI ----------
function wireUi() {
  $('close').onclick = () => window.api.close();
  $('min').onclick = () => window.api.minimize();
  $('pin').onclick = () => { state.pinned = !state.pinned; window.api.togglePin(state.pinned); $('pin').classList.toggle('on', state.pinned); };
  $('gear').onclick = () => {
    $('s-key').value = state.settings.coinglassKey || ''; $('s-refresh').value = (state.settings.refreshMs || 5000) / 1000;
    $('s-opacity').value = state.settings.opacity ?? 1; $('s-err').textContent = ''; $('settings').classList.remove('hidden');
  };
  $('s-cancel').onclick = () => $('settings').classList.add('hidden');
  $('s-opacity').oninput = (e) => window.api.setSettings({ opacity: Number(e.target.value) });
  $('s-save').onclick = async () => {
    state.settings = await window.api.setSettings({ coinglassKey: $('s-key').value.trim(), refreshMs: Number($('s-refresh').value) * 1000, opacity: Number($('s-opacity').value) });
    $('settings').classList.add('hidden'); state.tick = 0; startLoop();
  };
  window.addEventListener('resize', render);
}

(async function init() {
  state.settings = await window.api.getSettings();
  wireUi();
  startLoop();
})();
