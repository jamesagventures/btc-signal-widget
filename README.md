# BTC Signal Widget (v3)

A small always-on-top Bitcoin widget for Windows. It gives one call — **HOLD BTC** or **IN CASH** — from five tested signals, plus live price, charts and market context.

## Download (Windows)

**[Click here to download BTC-Signal-Widget.exe](https://github.com/jamesagventures/btc-signal-widget/raw/main/BTC-Signal-Widget.exe)**

Double-click the downloaded file to open it. Nothing to install.

First time only: if your browser warns about the file, choose **Keep** → **Keep anyway**. If Windows shows **"Windows protected your PC,"** click **More info**, then **Run anyway**.

Updating from an older version: close the widget (✕), download again from the same link, choose **Replace** if asked, and open it.

## Using it
- Drag the top bar to move it; drag the edges to resize.
- ⛶ full screen · ⤢ on any panel to enlarge it · **Esc** to go back.
- 📌 keeps it on top of other windows · ✕ closes it.

## How the call is made
Checked once a day at the daily close (7 PM Central). Hold BTC when the weighted vote is above zero:

| Signal | Weight |
|---|---|
| 200-day trend (with a 5% buffer) | ×2 |
| Pi Cycle top | ×2 |
| Weekly MACD | ×1 |
| Halving cycle (caution 450–830 days after a halving) | ×1 |
| Washed-out bottom (below 200-week average) | ×1 |

Backtest on 2020 → Oct 2026 (data the model was not tuned on): **53%/yr, worst drop −48%**, vs holding Bitcoin **44%/yr, worst drop −77%**.

Fear & Greed, funding, open interest and the flash-crash watch are shown for context only.

For personal use. Past results don't guarantee future ones. Not financial advice.
