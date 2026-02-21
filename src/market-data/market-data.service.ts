import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type { LivePrice } from '../common/types/index.js';

interface CachedPrice {
  data: LivePrice;
  expiresAt: number;
}

interface OhlcData {
  o: number;
  h: number;
  l: number;
  c: number;
  pc: number;
}

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  /** Price cache: ticker → { data, expiresAt } with 30s TTL */
  private readonly priceCache = new Map<string, CachedPrice>();
  private static readonly PRICE_CACHE_TTL_MS = 30_000;

  /** OHLC cache: ticker → daily open/high/low/close, populated once per trading day */
  private readonly ohlcCache = new Map<string, OhlcData>();
  private ohlcFetchedDate: string | null = null;

  /** Circuit breaker: skip Polygon for 5min after consecutive failures */
  private polygonConsecutiveFailures = 0;
  private polygonCircuitOpenUntil = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

  /** Ticker rotation index for pollMarketData — polls 5 per cycle */
  private pollRotationIndex = 0;
  private static readonly TICKERS_PER_POLL = 5;

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: ShockGlobeGateway,
  ) {}

  async getPrice(ticker: string): Promise<LivePrice> {
    // 0. Check price cache
    const cached = this.priceCache.get(ticker);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const polygonKey = this.config.get<string>('POLYGON_API_KEY');
    const alpacaKey = this.config.get<string>('ALPACA_API_KEY');
    const alpacaSecret = this.config.get<string>('ALPACA_API_SECRET');
    const fmpKey = this.config.get<string>('FMP_API_KEY');

    const seed = SEED_STOCKS.find((s) => s.ticker === ticker);
    const ohlc = this.ohlcCache.get(ticker);

    // 1. Try Polygon (with circuit breaker)
    if (polygonKey && !this.isPolygonCircuitOpen()) {
      try {
        const res = await axios.get<{ results: { p: number } }>(
          `https://api.polygon.io/v2/last/trade/${ticker}`,
          { params: { apiKey: polygonKey }, timeout: 2000 },
        );
        const price = res.data?.results?.p;
        if (price) {
          this.polygonConsecutiveFailures = 0;
          const result: LivePrice = {
            ticker,
            price,
            change: seed ? parseFloat((price - seed.price).toFixed(2)) : 0,
            changePercent: seed
              ? parseFloat((((price - seed.price) / seed.price) * 100).toFixed(2))
              : 0,
            source: 'polygon',
            ...(ohlc && {
              open: ohlc.o,
              high: ohlc.h,
              low: ohlc.l,
              previousClose: ohlc.pc,
            }),
          };
          this.setCachedPrice(ticker, result);
          return result;
        }
      } catch (err) {
        this.polygonConsecutiveFailures++;
        if (this.polygonConsecutiveFailures >= MarketDataService.CIRCUIT_BREAKER_THRESHOLD) {
          this.polygonCircuitOpenUntil = Date.now() + MarketDataService.CIRCUIT_BREAKER_COOLDOWN_MS;
          this.logger.warn(
            `Polygon circuit breaker OPEN after ${this.polygonConsecutiveFailures} failures. Skipping for 5min.`,
          );
        }
        this.logger.warn(`Polygon failed for ${ticker}: ${(err as Error).message}`);
      }
    }

    // 2. Try Alpaca
    if (alpacaKey && alpacaSecret) {
      try {
        const res = await axios.get<{ trade: { p: number } }>(
          `https://data.alpaca.markets/v2/stocks/${ticker}/trades/latest`,
          {
            headers: {
              'APCA-API-KEY-ID': alpacaKey,
              'APCA-API-SECRET-KEY': alpacaSecret,
            },
            timeout: 5000,
          },
        );
        const price = res.data?.trade?.p;
        if (price) {
          const result: LivePrice = {
            ticker,
            price,
            change: seed ? parseFloat((price - seed.price).toFixed(2)) : 0,
            changePercent: seed
              ? parseFloat((((price - seed.price) / seed.price) * 100).toFixed(2))
              : 0,
            source: 'alpaca',
            ...(ohlc && {
              open: ohlc.o,
              high: ohlc.h,
              low: ohlc.l,
              previousClose: ohlc.pc,
            }),
          };
          this.setCachedPrice(ticker, result);
          return result;
        }
      } catch (err) {
        this.logger.warn(`Alpaca failed for ${ticker}: ${(err as Error).message}`);
      }
    }

    // 3. Try FMP
    if (fmpKey) {
      try {
        const res = await axios.get<{ price: number }[]>(
          `https://financialmodelingprep.com/api/v3/quote-short/${ticker}`,
          { params: { apikey: fmpKey }, timeout: 5000 },
        );
        const price = res.data?.[0]?.price;
        if (price) {
          const result: LivePrice = {
            ticker,
            price,
            change: seed ? parseFloat((price - seed.price).toFixed(2)) : 0,
            changePercent: seed
              ? parseFloat((((price - seed.price) / seed.price) * 100).toFixed(2))
              : 0,
            source: 'fmp',
            ...(ohlc && {
              open: ohlc.o,
              high: ohlc.h,
              low: ohlc.l,
              previousClose: ohlc.pc,
            }),
          };
          this.setCachedPrice(ticker, result);
          return result;
        }
      } catch (err) {
        this.logger.warn(`FMP failed for ${ticker}: ${(err as Error).message}`);
      }
    }

    // 4. Seed fallback
    return {
      ticker,
      price: seed?.price ?? 0,
      change: seed?.priceChange ?? 0,
      changePercent: seed?.priceChangePercent ?? 0,
      source: 'seed',
    };
  }

  async getPrices(tickers: string[]): Promise<LivePrice[]> {
    const BATCH_SIZE = 5;
    const results: LivePrice[] = [];
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(batch.map((t) => this.getPrice(t)));
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
      if (i + BATCH_SIZE < tickers.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
    }
    return results;
  }

  /**
   * Fetch grouped daily OHLC for all US stocks in 1 API call.
   * Populates ohlcCache for our tracked tickers.
   * Only fetches once per trading day.
   */
  async fetchGroupedDaily(): Promise<void> {
    const polygonKey = this.config.get<string>('POLYGON_API_KEY');
    if (!polygonKey) return;

    const today = this.getPreviousTradingDay();
    if (this.ohlcFetchedDate === today) return;

    try {
      const res = await axios.get<{
        results?: { T: string; o: number; h: number; l: number; c: number }[];
      }>(
        `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${today}`,
        { params: { apiKey: polygonKey }, timeout: 10000 },
      );

      const trackedTickers = new Set(SEED_STOCKS.map((s) => s.ticker));
      const results = res.data?.results ?? [];

      for (const bar of results) {
        if (trackedTickers.has(bar.T)) {
          this.ohlcCache.set(bar.T, {
            o: bar.o,
            h: bar.h,
            l: bar.l,
            c: bar.c,
            pc: bar.c, // previous close = close of previous trading day
          });
        }
      }

      this.ohlcFetchedDate = today;
      this.logger.log(
        `Fetched grouped daily OHLC for ${today}: ${this.ohlcCache.size} tickers cached`,
      );
    } catch (err) {
      this.logger.warn(`Failed to fetch grouped daily OHLC: ${(err as Error).message}`);
    }
  }

  private isMarketHours(): boolean {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    const timeInMinutes = hour * 60 + minute;
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    return isWeekday && timeInMinutes >= marketOpen && timeInMinutes < marketClose;
  }

  /**
   * Poll market data every minute. Rotates through tickers — 5 per cycle
   * to stay within Polygon free tier (5 calls/min).
   * Also fetches grouped daily OHLC once per trading day.
   */
  @Cron('0 */1 * * * *')
  async pollMarketData(): Promise<void> {
    if (!this.isMarketHours()) return;

    // Fetch OHLC once per day (1 API call)
    await this.fetchGroupedDaily();

    const allTickers = SEED_STOCKS.map((s) => s.ticker);
    const batchSize = MarketDataService.TICKERS_PER_POLL;

    // Rotate through tickers
    const start = this.pollRotationIndex;
    const tickersToFetch: string[] = [];
    for (let i = 0; i < batchSize; i++) {
      tickersToFetch.push(allTickers[(start + i) % allTickers.length]);
    }
    this.pollRotationIndex = (start + batchSize) % allTickers.length;

    // Fetch with small delay between each to spread out calls
    for (const ticker of tickersToFetch) {
      try {
        const price = await this.getPrice(ticker);
        this.gateway.emitPriceUpdate({ ...price, timestamp: new Date().toISOString() });
      } catch (err) {
        this.logger.warn(`Poll failed for ${ticker}: ${(err as Error).message}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  private setCachedPrice(ticker: string, data: LivePrice): void {
    this.priceCache.set(ticker, {
      data,
      expiresAt: Date.now() + MarketDataService.PRICE_CACHE_TTL_MS,
    });
  }

  private isPolygonCircuitOpen(): boolean {
    if (this.polygonCircuitOpenUntil === 0) return false;
    if (Date.now() >= this.polygonCircuitOpenUntil) {
      // Reset circuit breaker
      this.polygonCircuitOpenUntil = 0;
      this.polygonConsecutiveFailures = 0;
      return false;
    }
    return true;
  }

  /**
   * Get the previous US trading day as YYYY-MM-DD.
   * Skips weekends. Doesn't account for holidays (good enough for demo).
   */
  private getPreviousTradingDay(): string {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 6=Sat
    let daysBack = 1;
    if (day === 0) daysBack = 2; // Sunday → Friday
    else if (day === 1) daysBack = 3; // Monday → Friday
    else if (day === 6) daysBack = 1; // Saturday → Friday

    const prev = new Date(now);
    prev.setDate(prev.getDate() - daysBack);
    return prev.toISOString().slice(0, 10);
  }
}
