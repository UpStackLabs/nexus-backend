import { Injectable } from '@nestjs/common';
import { SEED_STOCKS, SEED_SHOCKS } from '../common/data/seed-data.js';
import type { Stock, ShockScore } from '../common/types/index.js';

export interface SectorData {
  sector: string;
  stockCount: number;
  averageShockScore: number;
  predictedDirection: 'up' | 'down' | 'mixed';
  topStocks: Array<{
    ticker: string;
    companyName: string;
    shockScore: number;
  }>;
}

@Injectable()
export class SectorsService {
  getSectors(): SectorData[] {
    // Group stocks by sector
    const sectorMap = new Map<string, Stock[]>();
    for (const stock of SEED_STOCKS) {
      const existing = sectorMap.get(stock.sector) || [];
      existing.push(stock);
      sectorMap.set(stock.sector, existing);
    }

    const sectors: SectorData[] = [];

    for (const [sector, stocks] of sectorMap.entries()) {
      const tickers = stocks.map((s: Stock) => s.ticker);

      // Get all shocks for stocks in this sector
      const sectorShocks = SEED_SHOCKS.filter((shock: ShockScore) =>
        tickers.includes(shock.ticker),
      );

      // Compute average shock score
      const averageShockScore =
        sectorShocks.length > 0
          ? sectorShocks.reduce(
              (sum: number, s: ShockScore) => sum + s.score,
              0,
            ) / sectorShocks.length
          : 0;

      // Determine predicted direction based on shock directions
      const upCount = sectorShocks.filter(
        (s: ShockScore) => s.direction === 'up',
      ).length;
      const downCount = sectorShocks.filter(
        (s: ShockScore) => s.direction === 'down',
      ).length;

      let predictedDirection: 'up' | 'down' | 'mixed';
      if (sectorShocks.length === 0) {
        predictedDirection = 'mixed';
      } else if (upCount > downCount * 2) {
        predictedDirection = 'up';
      } else if (downCount > upCount * 2) {
        predictedDirection = 'down';
      } else {
        predictedDirection = 'mixed';
      }

      // Build a map of highest shock score per ticker in this sector
      const tickerBestShock = new Map<string, ShockScore>();
      for (const shock of sectorShocks) {
        const current = tickerBestShock.get(shock.ticker);
        if (!current || shock.score > current.score) {
          tickerBestShock.set(shock.ticker, shock);
        }
      }

      // Sort stocks by their best shock score descending to get top stocks
      const topStocks = stocks
        .map((stock: Stock) => {
          const bestShock = tickerBestShock.get(stock.ticker);
          return {
            ticker: stock.ticker,
            companyName: stock.companyName,
            shockScore: bestShock ? bestShock.score : 0,
          };
        })
        .sort((a, b) => b.shockScore - a.shockScore)
        .slice(0, 5);

      sectors.push({
        sector,
        stockCount: stocks.length,
        averageShockScore: Math.round(averageShockScore * 1000) / 1000,
        predictedDirection,
        topStocks,
      });
    }

    // Sort sectors by average shock score descending
    return sectors.sort((a, b) => b.averageShockScore - a.averageShockScore);
  }
}
