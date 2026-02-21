import { Injectable, NotFoundException } from '@nestjs/common';
import { SEED_STOCKS, SEED_SHOCKS } from '../common/data/seed-data.js';
import type {
  Stock,
  StockWithShockHistory,
  StockShockEntry,
  SurpriseAnalysis,
  SurpriseEntry,
  StockAnalysis,
} from '../common/types/index.js';
import type { QueryStocksDto } from './dto/query-stocks.dto.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { ShockEngineService } from '../shock-engine/shock-engine.service.js';

@Injectable()
export class StocksService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly shockEngine: ShockEngineService,
  ) {}

  findAll(query: QueryStocksDto): {
    data: Stock[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    let filtered = [...SEED_STOCKS];

    if (query.sector) {
      filtered = filtered.filter(
        (s) => s.sector.toLowerCase() === query.sector!.toLowerCase(),
      );
    }

    if (query.country) {
      filtered = filtered.filter(
        (s) => s.country.toLowerCase() === query.country!.toLowerCase(),
      );
    }

    if (query.exchange) {
      filtered = filtered.filter(
        (s) => s.exchange.toLowerCase() === query.exchange!.toLowerCase(),
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return { data, total, page, limit, totalPages };
  }

  findOne(ticker: string): StockWithShockHistory {
    const stock = SEED_STOCKS.find(
      (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
    );

    if (!stock) {
      throw new NotFoundException(`Stock with ticker "${ticker}" not found`);
    }

    const shockHistory: StockShockEntry[] = SEED_SHOCKS.filter(
      (shock) => shock.ticker.toLowerCase() === ticker.toLowerCase(),
    ).map((shock) => ({
      eventId: shock.eventId,
      eventTitle: `Event ${shock.eventId}`,
      shockScore: shock.score,
      predictedChange: shock.predictedChange,
      actualChange: shock.actualChange ?? 0,
      surpriseFactor: shock.surpriseFactor ?? 0,
      timestamp: new Date().toISOString(),
    }));

    return { ...stock, shockHistory };
  }

  async getAnalysis(ticker: string): Promise<StockAnalysis> {
    const stock = SEED_STOCKS.find(
      (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
    );
    if (!stock) {
      throw new NotFoundException(`Stock with ticker "${ticker}" not found`);
    }
    const livePrice = await this.marketData.getPrice(ticker.toUpperCase());
    const { relevantEvents, shockAnalysis } = await this.shockEngine.computeAnalysis(
      stock,
      livePrice.price,
    );
    return {
      ticker: stock.ticker,
      companyName: stock.companyName,
      sector: stock.sector,
      country: stock.country,
      currentPrice: livePrice.price,
      priceChange24h: livePrice.change,
      priceChangePercent24h: livePrice.changePercent,
      relevantEvents,
      shockAnalysis,
      analyzedAt: new Date().toISOString(),
    };
  }

  getHistory(
    ticker: string,
    timeframe: string,
  ): { date: string; price: number; volume: number }[] {
    const stock = SEED_STOCKS.find(
      (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
    );

    if (!stock) {
      throw new NotFoundException(`Stock with ticker "${ticker}" not found`);
    }

    // Deterministic seeded PRNG (mulberry32) so the same ticker always
    // returns the same chart regardless of when the request is made.
    const seed = ticker
      .toUpperCase()
      .split('')
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    const mulberry32 = (s: number) => {
      let state = s;
      return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let z = Math.imul(state ^ (state >>> 15), 1 | state);
        z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
        return z / 0x100000000;
      };
    };

    const rng = mulberry32(seed);

    // Volatility derived from the stock's daily percent change (clamped 0.5–4 %).
    const dailyVol = Math.max(0.005, Math.min(0.04, Math.abs(stock.priceChangePercent) / 100 || 0.015));

    interface TimeframeCfg {
      points: number;
      intervalMs: number;
      fmt: 'time' | 'datetime' | 'date';
    }

    const cfg: Record<string, TimeframeCfg> = {
      '1D': { points: 13, intervalMs: 30 * 60 * 1000,          fmt: 'time' },
      '1W': { points: 56, intervalMs: 2 * 60 * 60 * 1000,      fmt: 'datetime' },
      '1M': { points: 30, intervalMs: 24 * 60 * 60 * 1000,     fmt: 'date' },
      '3M': { points: 90, intervalMs: 24 * 60 * 60 * 1000,     fmt: 'date' },
      '1Y': { points: 52, intervalMs: 7 * 24 * 60 * 60 * 1000, fmt: 'date' },
    };

    const { points, intervalMs, fmt } = cfg[timeframe] ?? cfg['1M'];

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const formatDate = (d: Date, mode: TimeframeCfg['fmt']): string => {
      if (mode === 'time') {
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
      }
      const mon = months[d.getMonth()];
      const day = String(d.getDate()).padStart(2, '0');
      if (mode === 'datetime') {
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${mon} ${day} ${h}:${m}`;
      }
      return `${mon} ${day}`;
    };

    const now = Date.now();
    const endMs = now - intervalMs; // end one interval before "now" so last point is not the live price

    // Start price is ~95 % of current, then we random-walk forward to current.
    let price = stock.price * 0.95;
    const result: { date: string; price: number; volume: number }[] = [];

    for (let i = 0; i < points; i++) {
      const pointMs = endMs - (points - 1 - i) * intervalMs;
      const date = formatDate(new Date(pointMs), fmt);

      // Geometric Brownian Motion step
      const drift = (stock.priceChange / stock.price) / points; // slight trend toward current price
      const shock = dailyVol * (rng() * 2 - 1);
      price = price * (1 + drift + shock);
      price = Math.max(price, 0.01); // prevent negative

      // Volume: uniform random around base volume ±30 %
      const volume = Math.round(stock.volume * (0.7 + rng() * 0.6));

      result.push({ date, price: Math.round(price * 100) / 100, volume });
    }

    return result;
  }

  getSurpriseAnalysis(ticker: string): SurpriseAnalysis {
    const stock = SEED_STOCKS.find(
      (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
    );

    if (!stock) {
      throw new NotFoundException(`Stock with ticker "${ticker}" not found`);
    }

    const stockShocks = SEED_SHOCKS.filter(
      (shock) =>
        shock.ticker.toLowerCase() === ticker.toLowerCase() &&
        shock.surpriseFactor !== null,
    );

    const recentSurprises: SurpriseEntry[] = stockShocks.map((shock) => ({
      eventId: shock.eventId,
      eventTitle: `Event ${shock.eventId}`,
      predictedChange: shock.predictedChange,
      actualChange: shock.actualChange ?? 0,
      surpriseFactor: shock.surpriseFactor ?? 0,
      timestamp: new Date().toISOString(),
    }));

    const surpriseValues = recentSurprises.map((s) => s.surpriseFactor);
    const currentSurpriseFactor =
      surpriseValues.length > 0
        ? surpriseValues.reduce((sum, v) => sum + v, 0) / surpriseValues.length
        : 0;

    const historicalAvgSurprise = currentSurpriseFactor;
    const isAnomaly = currentSurpriseFactor > 2;

    return {
      ticker: stock.ticker,
      companyName: stock.companyName,
      currentSurpriseFactor: Math.round(currentSurpriseFactor * 100) / 100,
      historicalAvgSurprise: Math.round(historicalAvgSurprise * 100) / 100,
      isAnomaly,
      recentSurprises,
    };
  }
}
