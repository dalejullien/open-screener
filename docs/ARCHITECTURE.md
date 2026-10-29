# Architecture

Open Screener is a static React application. The browser fetches public market data, caches candles in IndexedDB, runs strategy plug-ins against completed bars, and renders ranked research setups.

```text
Binance + CoinGecko
        |
 market data and metadata
        |
 browser cache -> scanner plug-ins -> ranking and confluence -> charts and journal
                           |
                    backtest worker
```

Each scanner implements the shared `Scanner` contract in `src/lib/types.ts` and returns a common `Signal`. This keeps market-data loading, charts, ranking, journaling and backtesting independent from individual strategy rules.

The application has no backend, account database, exchange credentials or execution path. Settings and research history remain in local browser storage.
