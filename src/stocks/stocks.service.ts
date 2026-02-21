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
import type { MarketDataService } from '../market-data/market-data.service.js';
import type { ShockEngineService } from '../shock-engine/shock-engine.service.js';

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
