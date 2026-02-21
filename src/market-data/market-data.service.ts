import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type { LivePrice } from '../common/types/index.js';

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: ShockGlobeGateway,
  ) {}

  async getPrice(ticker: string): Promise<LivePrice> {
    const polygonKey = this.config.get<string>('POLYGON_API_KEY');
    const alpacaKey = this.config.get<string>('ALPACA_API_KEY');
    const alpacaSecret = this.config.get<string>('ALPACA_API_SECRET');
    const fmpKey = this.config.get<string>('FMP_API_KEY');

    // 1. Try Polygon
    if (polygonKey) {
      try {
        const res = await axios.get<{ results: { p: number } }>(
          `https://api.polygon.io/v2/last/trade/${ticker}`,
          { params: { apiKey: polygonKey }, timeout: 5000 },
        );
        const price = res.data?.results?.p;
        if (price) {
          const seed = SEED_STOCKS.find((s) => s.ticker === ticker);
          return {
            ticker,
            price,
            change: seed ? parseFloat((price - seed.price).toFixed(2)) : 0,
            changePercent: seed
              ? parseFloat((((price - seed.price) / seed.price) * 100).toFixed(2))
              : 0,
            source: 'polygon',
          };
        }
      } catch {
        // fall through
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
          const seed = SEED_STOCKS.find((s) => s.ticker === ticker);
          return {
            ticker,
            price,
            change: seed ? parseFloat((price - seed.price).toFixed(2)) : 0,
            changePercent: seed
              ? parseFloat((((price - seed.price) / seed.price) * 100).toFixed(2))
              : 0,
            source: 'alpaca',
          };
        }
      } catch {
        // fall through
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
          const seed = SEED_STOCKS.find((s) => s.ticker === ticker);
          return {
            ticker,
            price,
            change: seed ? parseFloat((price - seed.price).toFixed(2)) : 0,
            changePercent: seed
              ? parseFloat((((price - seed.price) / seed.price) * 100).toFixed(2))
              : 0,
            source: 'fmp',
          };
        }
      } catch {
        // fall through
      }
    }

    // 4. Seed fallback
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

  @Cron('0 */1 * * * *')
  async pollMarketData(): Promise<void> {
    if (!this.isMarketHours()) return;
    const tickers = SEED_STOCKS.map((s) => s.ticker);
    const prices = await this.getPrices(tickers);
    for (const price of prices) {
      this.gateway.emitPriceUpdate({ ...price, timestamp: new Date().toISOString() });
    }
  }
}
