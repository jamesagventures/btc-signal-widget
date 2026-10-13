# BTC Signal Widget

A small always-on-top Bitcoin widget for Windows: Fear & Greed, 30-day liquidation map, weekly RSI & MACD, live price, and a BUY / SELL / HOLD signal.

## Download (Windows)

**[Click here to download BTC-Signal-Widget.exe](https://github.com/jamesagventures/btc-signal-widget/raw/main/BTC-Signal-Widget.exe)**

Then double-click the downloaded file to open it. Nothing to install.

The first time, Windows may show **"Windows protected your PC."** Click **More info**, then **Run anyway**.

## Using it
- Drag the top bar to move it. Drag the edges to resize.
- 📌 keeps it on top of other windows. ✕ closes it.
- ⚙ settings: an optional Coinglass API key (turns on the long/short liquidation vote), refresh speed, and opacity.

## Signal rules
- Fear & Greed under 30 → buy, over 70 → sell
- 30-day liquidations: longs 4× shorts → sell, shorts 4× longs → buy
- Weekly RSI under 30 and rising → buy, over 70 and falling → sell
- Weekly MACD up from last week → buy, down → sell
- Overall signal = whichever side has more votes

For personal use only. Not financial advice.
