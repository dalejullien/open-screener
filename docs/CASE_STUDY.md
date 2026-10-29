# Open Screener case study

## Problem

Reviewing hundreds of crypto charts across several timeframes is slow, inconsistent and hard to validate. A useful screener must narrow the market without hiding why an asset ranked highly.

## Product decision

Open Screener treats strategies as independent plug-ins. Every result includes its rule state, completed-bar chart, trigger and invalidation levels, ranking inputs and plain-English methodology. A cross-strategy page ranks one setup per asset, while the Forward Journal preserves first-seen results before outcomes are known.

## Engineering highlights

- Roughly 550 Binance assets, with spot and perpetual markets deduplicated
- Incremental IndexedDB candle cache and browser-only public APIs
- Multi-timeframe completed-bar scanning without look-ahead
- Web Workers for pattern matching and backtests
- Ranked setup aggregation, confluence, deep links and CSV export
- Deterministic risk models and an append-only forward journal

## What the evidence changed

Early tests showed that attractive charts were not automatically actionable. The product now labels late breakouts as Extended, rejects overly wide invalidation distances, separates illiquid low caps, and records regime and liquidity for forward validation.

## Boundaries

This is research software, not a signal service or execution system. Backtests contain survivorship and selection bias, and rankings are not win probabilities.
