# How each strategy works (plain English)

Every tool looks only at **completed candles** (never the one still forming), so a signal never
"repaints". Each tool gives a coin one of four states:
**Trigger** (setup + confirmation) · **Pass** (setup in place) · **Near miss** · **Fail**.
On top of that, every setup gets a **research state**: ● Triggered · ◔ Forming · ▲ Extended · ○ Invalidated.

R = multiples of the amount you risk. +1R = you made what you risked. At 1% risk per trade, +0.4R ≈ +0.4% of the account.

---

## ★ S-Tier Setups — "the cleanest setups, graded S / A / B"
Only coins already in a healthy uptrend (price above the 50-day average, which is above a rising 200-day average).
It looks for one of three setups:
1. **RSI-reset pullback** — the trend is intact, daily RSI cools to 38–50, price dips to the 20-day average, then the 4h chart turns back up. Stop: just under that 4h swing low.
2. **Tight-base breakout (VCP)** — after a run of 30%+, price goes quiet in a tight 7-day range, then breaks out on 1.5× normal volume. Stop: under the base.
3. **Squeeze breakout** — volatility shrinks to a 4-month low, then price breaks out on volume. Stop: under the squeeze range.

**Grade S** needs all of: tight stop (≤ 1 ATR / 0.6 × average daily range / 6%), ≥ 3R room to the next resistance,
BTC above its 50-day average, ≥ $5M daily volume, score ≥ 80/100, and the trigger fired.
**Known issue:** the tight-stop rule is too strict for crypto, so almost everything grades **B**. B-tier is still the
best-performing group in backtests (+1.29R/trade, 61% win, top 50 coins, 120 days). Rebuilding the grades is next.

## ↗ Trend Continuation — "uptrends with momentum, flag the volume spikes"
Daily close above both the 12- and 25-day EMAs (trend) + 4h RSI above 50 (momentum).
**Trigger** = both, plus the last 4h candle traded ≥ 2× its normal volume (fresh buying).
Stop: under the latest 4h swing low (or 2× daily ATR if tighter isn't available). Targets 1.5R and 3R.

## ↺ Second Chance — "missed the pump? catch the pullback"
For coins that pumped ≥ 30% within ~15 days on ≥ 2× volume and are now pulling back.
Buy zone: when it has given back 38–62% of the pump **on falling volume** (profit-taking, not panic).
**Trigger** = the 4h chart turns back up inside that zone. Stop: under the pullback low. Targets: retest of the peak, then a full repeat of the pump.

## ⇡ Relative Strength — "who is leading Bitcoin"
Ranks every coin by how much it beat its benchmark (BTC for crypto, SPY for stocks, gold for commodities)
over 7, 30 and 90 days (weighted 20/40/40), as a percentile.
**Pass** = top 25% **and** price above its 50-day average. **Trigger** = also accelerating (7-day lead stronger than 30-day).
Logic: leaders tend to keep leading; you want to own the strongest horses.

## ⇥ Volatility Squeeze — "volatility coiled tight, expansion tends to follow"
Bollinger Band width (how wide the price range is) in the bottom 15% of its last 120 days = squeeze.
**Trigger** = after a squeeze, price closes outside the band (breakout). A squeeze predicts a big move, not its direction — the breakout gives the direction.
Best win rate in backtests (66%).

## ⤒ Range Breakout — "closes above the range high, volume confirms"
Close above the highest high of the previous 20 days. **Trigger** = with ≥ 1.5× normal daily volume.
Near miss = within 3% of the high. A breakout that is already more than 5% above the range high remains a valid
detected setup but is labelled **Extended**; it is no longer near the original trigger level.

## ⌁ Chart Patterns — "recognise formations, follow their breakouts"
Finds 15 classic patterns using swing highs/lows at two sizes: double/triple tops & bottoms,
(inverse) head & shoulders, ascending/descending/symmetrical triangles, rising/falling wedges, bull/bear flags & pennants.
**Forming** until price closes through the boundary; **Confirmed** on the breakout; **Failed** if the opposite side breaks first.
Target = measured move (pattern height). Quality score = how cleanly it fits the textbook shape (not a win probability).

## ∿ Pattern Match — "find familiar shapes, explore what followed"
Compares each coin's last 60 bars with every historical 60-bar window across all coins, takes the 5 closest shapes and shows
what happened next (volatility-adjusted), with a weighted estimate. Historical scenarios, not a forecast. Not backtested yet.

## ≋ Signal Confluence — "where several strategies agree"
Counts how many tools fire on the same coin (trigger = 2 points, pass = 1). More agreement = higher priority.

## ◎ Research Setups (default page)
One list of what to act on today: every tool's **Enter** setups plus **Wait** setups with a concrete trigger price,
one per coin, ranked by that tool's backtest result + how many tools agree.

---

## Backtest league (top 50 coins, 120 days, daily, run 2026-10-14)
| # | Strategy | Trades | Win | Hit target | Stopped | Avg R |
|---|---|---|---|---|---|---|
| 1 | S-Tier (almost all B-tier) | 19 | 58% | 47% | 26% | +1.17R |
| 2 | Volatility Squeeze | 61 | 66% | 61% | 33% | +0.56R |
| 3 | Chart Patterns | 100 | 60% | 47% | 29% | +0.42R |
| 4 | Trend Continuation | 130 | 58% | 55% | 39% | +0.40R |
| 5 | Second Chance | 39 | 46% | 46% | 51% | +0.36R |
| 6 | Range Breakout | 154 | 51% | 51% | 48% | +0.25R |
| 7 | Relative Strength | 67 | 54% | 40% | 42% | +0.19R |

Caveats: small samples, today's top coins only (survivorship), daily bars, one 120-day period.
