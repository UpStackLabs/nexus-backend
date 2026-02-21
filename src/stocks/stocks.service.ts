import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SEED_STOCKS, SEED_SHOCKS } from '../common/data/seed-data.js';
import type {
  Stock,
  StockWithShockHistory,
  StockShockEntry,
  SurpriseAnalysis,
  SurpriseEntry,
  StockAnalysis,
  PredictionPoint,
  PredictionResult,
  ShockFactor,
} from '../common/types/index.js';
import type { QueryStocksDto } from './dto/query-stocks.dto.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { ShockEngineService } from '../shock-engine/shock-engine.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';

@Injectable()
export class StocksService {
  private readonly logger = new Logger(StocksService.name);

  constructor(
    private readonly marketData: MarketDataService,
    private readonly shockEngine: ShockEngineService,
    private readonly nlp: SphinxNlpService,
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

  async getQuotes(
    tickers: string[],
  ): Promise<
    Record<
      string,
      { c: number; h: number; l: number; o: number; pc: number; d: number; dp: number; t: number }
    >
  > {
    const prices = await this.marketData.getPrices(
      tickers.length > 0 ? tickers : SEED_STOCKS.map((s) => s.ticker),
    );

    const result: Record<
      string,
      { c: number; h: number; l: number; o: number; pc: number; d: number; dp: number; t: number }
    > = {};

    for (const lp of prices) {
      const pc = lp.previousClose ?? lp.price - lp.change;
      result[lp.ticker] = {
        c: lp.price,
        pc,
        o: lp.open ?? pc,
        h: lp.high ?? Math.round(lp.price * 1.005 * 100) / 100,
        l: lp.low ?? Math.round(lp.price * 0.995 * 100) / 100,
        d: lp.change,
        dp: lp.changePercent,
        t: Math.floor(Date.now() / 1000),
      };
    }

    return result;
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

  async getHistory(
    ticker: string,
    timeframe: string,
  ): Promise<{ date: string; price: number; volume: number }[]> {
    const stock = SEED_STOCKS.find(
      (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
    );

    if (!stock) {
      throw new NotFoundException(`Stock with ticker "${ticker}" not found`);
    }

    // Try real Polygon candle data first
    const validTimeframes = ['1D', '1W', '1M', '3M', '1Y'];
    if (validTimeframes.includes(timeframe)) {
      try {
        const candles = await this.marketData.getHistoricalCandles(
          ticker.toUpperCase(),
          timeframe as '1D' | '1W' | '1M' | '3M' | '1Y',
        );
        if (candles && candles.length > 0) {
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          return candles.map((c) => {
            const d = new Date(c.date);
            let date: string;
            if (timeframe === '1D') {
              date = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            } else if (timeframe === '1W') {
              date = `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            } else {
              date = `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
            }
            return { date, price: c.close, volume: c.volume };
          });
        }
      } catch (err) {
        this.logger.warn(`Historical candles failed for ${ticker}/${timeframe}: ${(err as Error).message}`);
      }
    }

    // Fall back to PRNG-generated chart
    return this.generateFakeHistory(stock, ticker, timeframe);
  }

  private generateFakeHistory(
    stock: Stock,
    ticker: string,
    timeframe: string,
  ): { date: string; price: number; volume: number }[] {
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

  async predictTrajectory(ticker: string, days: number): Promise<PredictionResult> {
    const stock = SEED_STOCKS.find(
      (s) => s.ticker.toLowerCase() === ticker.toLowerCase(),
    );
    if (!stock) {
      throw new NotFoundException(`Stock with ticker "${ticker}" not found`);
    }

    // 1. Get current price
    const livePrice = await this.marketData.getPrice(ticker.toUpperCase());
    const currentPrice = livePrice.price;

    // 2. Compute shock analysis
    const { relevantEvents, shockAnalysis } =
      await this.shockEngine.computeAnalysis(stock, currentPrice);

    // 3. Build shock factors
    const shockFactors: ShockFactor[] = relevantEvents.slice(0, 5).map((e) => ({
      eventTitle: e.title,
      type: e.type,
      severity: e.severity,
      impactScore: parseFloat((e.vectorSimilarity * shockAnalysis.compositeShockScore).toFixed(3)),
      direction: shockAnalysis.direction,
    }));

    // 4. Generate 30-day forward trajectory
    //    Shock-adjusted drift with exponential decay + stochastic volatility
    const { compositeShockScore, predictedPriceChange, confidence, direction } = shockAnalysis;
    const dailyDrift = (predictedPriceChange / 100) / days;
    const dailyVol = Math.max(
      0.005,
      Math.min(0.04, Math.abs(stock.priceChangePercent) / 100 || 0.015),
    );

    // Deterministic PRNG seeded by ticker + today's date for reproducibility
    const today = new Date().toISOString().slice(0, 10);
    const seedVal = `${ticker}${today}`
      .split('')
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    let state = seedVal;
    const rng = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let z = Math.imul(state ^ (state >>> 15), 1 | state);
      z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
      return z / 0x100000000;
    };

    const trajectory: PredictionPoint[] = [];
    let price = currentPrice;
    const now = new Date();

    for (let i = 1; i <= days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);

      // Exponential decay of shock influence
      const shockDecay = Math.exp(-i / (days * 0.4));
      const shockDrift = dailyDrift * shockDecay * compositeShockScore * 10;
      const directionSign = direction === 'up' ? 1 : -1;

      // GBM step with shock adjustment
      const randomShock = dailyVol * (rng() * 2 - 1);
      price = price * (1 + shockDrift * directionSign + randomShock);
      price = Math.max(price, 0.01);

      // Confidence band widens over time
      const bandWidth = currentPrice * dailyVol * Math.sqrt(i) * (2 - confidence);

      trajectory.push({
        date: date.toISOString().slice(0, 10),
        price: Math.round(price * 100) / 100,
        upper: Math.round((price + bandWidth) * 100) / 100,
        lower: Math.round(Math.max(0.01, price - bandWidth) * 100) / 100,
      });
    }

    // 5. Generate AI narrative
    const aiSummary = await this.generatePredictionNarrative(
      stock,
      currentPrice,
      trajectory,
      shockAnalysis,
      relevantEvents,
    );

    return {
      ticker: stock.ticker,
      companyName: stock.companyName,
      currentPrice,
      trajectory,
      shockFactors,
      aiSummary,
      confidence: shockAnalysis.confidence,
      generatedAt: new Date().toISOString(),
    };
  }

  private async generatePredictionNarrative(
    stock: Stock,
    currentPrice: number,
    trajectory: PredictionPoint[],
    shockAnalysis: any,
    relevantEvents: any[],
  ): Promise<string> {
    const lastPoint = trajectory[trajectory.length - 1];
    const priceChange = ((lastPoint.price - currentPrice) / currentPrice * 100).toFixed(1);
    const eventSummary = relevantEvents
      .slice(0, 3)
      .map((e) => `${e.title} (severity ${e.severity}/10)`)
      .join('; ');

    const prompt = `You are a financial analyst. Write a concise 2-3 sentence prediction summary for ${stock.companyName} (${stock.ticker}).
Current price: $${currentPrice}. Predicted ${trajectory.length}-day price: $${lastPoint.price} (${priceChange}%).
Shock score: ${shockAnalysis.compositeShockScore}, risk level: ${shockAnalysis.riskLevel}.
Key events: ${eventSummary}.
Focus on the key drivers and risk factors. Be direct and quantitative.`;

    try {
      const narrative = await this.nlp.generateText(prompt);
      return narrative;
    } catch {
      this.logger.debug('AI narrative generation failed, using template');
      const direction = parseFloat(priceChange) >= 0 ? 'upward' : 'downward';
      return `${stock.companyName} is projected to move ${direction} by ${Math.abs(parseFloat(priceChange))}% over the next ${trajectory.length} days, driven by a composite shock score of ${shockAnalysis.compositeShockScore} (${shockAnalysis.riskLevel} risk). Key events influencing this forecast include ${relevantEvents[0]?.title ?? 'global market conditions'}.`;
    }
  }
}
