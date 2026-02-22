import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { NexusGateway } from '../gateway/nexus.gateway.js';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type { LivePrice, HistoricalCandle } from '../common/types/index.js';

interface CachedCandles {
  data: HistoricalCandle[];
  expiresAt: number;
}

type HistoricalTimeframe = '1D' | '1W' | '1M' | '3M' | '1Y';

/** Yahoo v8 chart response shape (subset we use) */
interface YahooChartResult {
  meta: {
    symbol: string;
    regularMarketPrice: number;
    chartPreviousClose: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: {
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }[];
  };
}

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);

  /** All stock prices, refreshed every 5 min */
  private prices = new Map<string, LivePrice>();

  /** Historical candle cache: "ticker:timeframe" → { data, expiresAt } */
  private readonly candleCache = new Map<string, CachedCandles>();

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: NexusGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshAllPrices();
  }

  // ──────────────────────────────────────────────────────────────────
  // Price access
  // ──────────────────────────────────────────────────────────────────

  async getPrice(ticker: string): Promise<LivePrice> {
    const cached = this.prices.get(ticker);
    if (cached) return cached;

    // Not in batch — try individual Yahoo lookup
    const result = await this.fetchYahooQuote(ticker);
    if (result) return result;

    // Seed fallback
    const seed = SEED_STOCKS.find((s) => s.ticker === ticker);
    return {
      ticker,
      price: seed?.price ?? 0,
      change: seed?.priceChange ?? 0,
      changePercent: seed?.priceChangePercent ?? 0,
      source: 'seed',
    };
  }

  async getPrices(tickers: string[]): Promise<LivePrice[]> {
    return Promise.all(tickers.map((t) => this.getPrice(t)));
  }

  // ──────────────────────────────────────────────────────────────────
  // Batch refresh — Yahoo v8 chart endpoint, 1 call per ticker
  // but the meta field gives us current price. Fetch sequentially.
  // ──────────────────────────────────────────────────────────────────

  /** Refresh every 5 minutes */
  @Cron('0 */5 * * * *')
  async refreshAllPrices(): Promise<void> {
    const allTickers = SEED_STOCKS.map((s) => s.ticker);
    let count = 0;

    // Fetch in parallel batches of 10 with 500ms between batches
    for (let i = 0; i < allTickers.length; i += 10) {
      const batch = allTickers.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map((t) => this.fetchYahooQuote(t)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) count++;
      }
      if (i + 10 < allTickers.length) {
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    }

    if (count > 0) {
      this.logger.log(`Price refresh: ${count}/${allTickers.length} tickers updated via Yahoo`);
    } else {
      this.logger.warn('Yahoo refresh returned 0 prices — falling back to Finnhub');
      await this.finnhubFallback(allTickers);
    }
  }

  /** Fetch a single quote via Yahoo v8 chart endpoint (free, no key) */
  private async fetchYahooQuote(ticker: string): Promise<LivePrice | null> {
    try {
      const res = await axios.get<{ chart?: { result?: YahooChartResult[] } }>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
        {
          params: { interval: '1d', range: '1d' },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000,
        },
      );

      const meta = res.data?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return null;

      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose ?? price;
      const change = parseFloat((price - prevClose).toFixed(2));
      const changePct = prevClose !== 0
        ? parseFloat(((change / prevClose) * 100).toFixed(2))
        : 0;

      const lp: LivePrice = {
        ticker: meta.symbol ?? ticker,
        price,
        change,
        changePercent: changePct,
        source: 'yahoo',
        high: meta.regularMarketDayHigh,
        low: meta.regularMarketDayLow,
        previousClose: prevClose,
      };
      this.prices.set(lp.ticker, lp);
      return lp;
    } catch {
      return null;
    }
  }

  /** Fallback: fetch prices from Finnhub one-by-one */
  private async finnhubFallback(tickers: string[]): Promise<void> {
    const key = this.config.get<string>('FINNHUB_API_KEY');
    if (!key) return;

    let count = 0;
    for (const ticker of tickers) {
      if (this.prices.has(ticker)) continue;
      try {
        const res = await axios.get<{
          c: number; d: number; dp: number; h: number; l: number; o: number; pc: number;
        }>(
          'https://finnhub.io/api/v1/quote',
          { params: { symbol: ticker, token: key }, timeout: 8000 },
        );
        const q = res.data;
        if (q?.c && q.c !== 0) {
          this.prices.set(ticker, {
            ticker,
            price: q.c,
            change: q.d,
            changePercent: q.dp,
            source: 'finnhub',
            open: q.o,
            high: q.h,
            low: q.l,
            previousClose: q.pc,
          });
          count++;
        }
      } catch {
        // skip
      }
      await new Promise<void>((r) => setTimeout(r, 1100));
    }
    if (count > 0) this.logger.log(`Finnhub fallback: ${count} prices fetched`);
  }

  // ──────────────────────────────────────────────────────────────────
  // Historical candles — Yahoo v8 chart + Polygon fallback
  // ──────────────────────────────────────────────────────────────────

  async getHistoricalCandles(
    ticker: string,
    timeframe: HistoricalTimeframe,
  ): Promise<HistoricalCandle[] | null> {
    const cacheKey = `${ticker}:${timeframe}`;
    const cached = this.candleCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const cfg: Record<HistoricalTimeframe, {
      interval: string; range: string; cacheTtlMs: number;
    }> = {
      '1D': { interval: '5m',  range: '1d',  cacheTtlMs: 5 * 60 * 1000 },
      '1W': { interval: '30m', range: '5d',  cacheTtlMs: 5 * 60 * 1000 },
      '1M': { interval: '1d',  range: '1mo', cacheTtlMs: 60 * 60 * 1000 },
      '3M': { interval: '1d',  range: '3mo', cacheTtlMs: 60 * 60 * 1000 },
      '1Y': { interval: '1wk', range: '1y',  cacheTtlMs: 60 * 60 * 1000 },
    };
    const yCfg = cfg[timeframe];

    // 1. Yahoo v8 chart
    try {
      const res = await axios.get<{ chart?: { result?: YahooChartResult[] } }>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
        {
          params: { interval: yCfg.interval, range: yCfg.range },
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000,
        },
      );

      const r = res.data?.chart?.result?.[0];
      const ts = r?.timestamp ?? [];
      const q = r?.indicators?.quote?.[0];

      if (ts.length > 0 && q) {
        const candles: HistoricalCandle[] = [];
        for (let i = 0; i < ts.length; i++) {
          const c = q.close?.[i];
          if (c != null) {
            candles.push({
              date: new Date(ts[i] * 1000).toISOString(),
              open: q.open?.[i] ?? c,
              high: q.high?.[i] ?? c,
              low: q.low?.[i] ?? c,
              close: c,
              volume: q.volume?.[i] ?? 0,
            });
          }
        }
        if (candles.length > 0) {
          this.candleCache.set(cacheKey, { data: candles, expiresAt: Date.now() + yCfg.cacheTtlMs });
          return candles;
        }
      }
    } catch (err) {
      this.logger.warn(`Yahoo chart failed for ${ticker}/${timeframe}: ${(err as Error).message}`);
    }

    // 2. Polygon fallback
    const polygonKey = this.config.get<string>('POLYGON_API_KEY');
    if (!polygonKey) return null;

    const pCfg: Record<HistoricalTimeframe, {
      multiplier: number; timespan: string; daysBack: number;
    }> = {
      '1D': { multiplier: 5,  timespan: 'minute', daysBack: 1 },
      '1W': { multiplier: 30, timespan: 'minute', daysBack: 7 },
      '1M': { multiplier: 1,  timespan: 'day',    daysBack: 30 },
      '3M': { multiplier: 1,  timespan: 'day',    daysBack: 90 },
      '1Y': { multiplier: 1,  timespan: 'week',   daysBack: 365 },
    };
    const p = pCfg[timeframe];
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - p.daysBack);

    try {
      const res = await axios.get<{
        results?: { t: number; o: number; h: number; l: number; c: number; v: number }[];
      }>(
        `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${p.multiplier}/${p.timespan}/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}`,
        { params: { apiKey: polygonKey, sort: 'asc', limit: 5000 }, timeout: 10000 },
      );
      const bars = res.data?.results;
      if (bars && bars.length > 0) {
        const candles: HistoricalCandle[] = bars.map((bar) => ({
          date: new Date(bar.t).toISOString(),
          open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v,
        }));
        this.candleCache.set(cacheKey, { data: candles, expiresAt: Date.now() + yCfg.cacheTtlMs });
        return candles;
      }
    } catch (err) {
      this.logger.warn(`Polygon candles failed for ${ticker}/${timeframe}: ${(err as Error).message}`);
    }

    return null;
  }
}
