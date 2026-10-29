# Contributing

Thanks for helping! The most valuable contributions are **new strategies** and **better tests of
existing ones**.

## Ground rules for strategies

1. **Completed bars only.** `daily` and `h4` already exclude the forming candle — don't fetch your own.
2. **No look-ahead.** A signal at bar *t* may only use data up to bar *t*.
3. **Explain yourself.** `reason` must say in plain English why the coin passed or failed, and
   `methodology` must list the exact rules and default parameters.
4. **Scores are ranks, not probabilities.** Never label a score as a chance of winning.
5. **Keep it pure.** `run()` takes data in and returns a `Signal`; no network calls or globals.
   Use `finalize()` for cross-sectional work (e.g. percentile ranks).
6. Reuse helpers in `src/lib/indicators.ts`; add new indicators there with a one-line doc comment.

## Workflow

```bash
npm install
npm run dev      # app at http://localhost:5173
npm run build    # typecheck + production build
npm run lint
```

Open a pull request with: what the strategy finds, its rules, a screenshot, and (once the
backtest harness lands) its backtest summary.

## Never commit

API keys, `.env` files, personal watchlists or account data.

By contributing you agree your work is licensed under AGPL-3.0.
