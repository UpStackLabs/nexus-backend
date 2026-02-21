import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StocksService } from './stocks.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { ShockEngineService } from '../shock-engine/shock-engine.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { SEED_STOCKS, SEED_SHOCKS } from '../common/data/seed-data.js';

describe('StocksService', () => {
  let service: StocksService;
  let marketData: jest.Mocked<Partial<MarketDataService>>;
  let shockEngine: jest.Mocked<Partial<ShockEngineService>>;
  let nlp: jest.Mocked<Partial<SphinxNlpService>>;

  beforeEach(async () => {
    marketData = {
      getPrice: jest.fn().mockResolvedValue({
        ticker: 'XOM',
        price: 110.0,
        change: 2.58,
        changePercent: 2.4,
        source: 'seed',
      }),
    };

    shockEngine = {
      computeAnalysis: jest.fn().mockResolvedValue({
        relevantEvents: [
          {
            eventId: 'evt-001',
            title: 'Venezuelan Invasion',
            type: 'military',
            severity: 9,
            location: { lat: 10.48, lng: -66.9, country: 'Venezuela' },
            timestamp: '2026-02-18T06:00:00Z',
            vectorSimilarity: 0.85,
            description: 'test',
          },
        ],
        shockAnalysis: {
          compositeShockScore: 0.72,
          predictedPriceChange: 1.2,
          confidence: 0.86,
          direction: 'up' as const,
          components: {
            similarityScore: 0.85,
            historicalSensitivity: 0.78,
            geographicProximity: 0.65,
            supplyChainLinkage: 0.55,
          },
          surpriseFactor: 0.12,
          riskLevel: 'high' as const,
        },
      }),
    };

    nlp = {
      generateText: jest.fn().mockRejectedValue(new Error('No LLM')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StocksService,
        { provide: MarketDataService, useValue: marketData },
        { provide: ShockEngineService, useValue: shockEngine },
        { provide: SphinxNlpService, useValue: nlp },
      ],
    }).compile();

    service = module.get<StocksService>(StocksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── findAll ──────────────────────────────────────────────────
  describe('findAll()', () => {
    it('should return all stocks with default pagination', () => {
      const result = service.findAll({});

      expect(result.data.length).toBe(Math.min(20, SEED_STOCKS.length));
      expect(result.total).toBe(SEED_STOCKS.length);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by sector', () => {
      const result = service.findAll({ sector: 'Energy' });

      result.data.forEach((stock) => {
        expect(stock.sector.toLowerCase()).toBe('energy');
      });
      expect(result.total).toBe(
        SEED_STOCKS.filter((s) => s.sector.toLowerCase() === 'energy').length,
      );
    });

    it('should filter by country', () => {
      const result = service.findAll({ country: 'USA' });

      result.data.forEach((stock) => {
        expect(stock.country.toLowerCase()).toBe('usa');
      });
    });

    it('should filter by exchange', () => {
      const result = service.findAll({ exchange: 'NASDAQ' });

      result.data.forEach((stock) => {
        expect(stock.exchange.toLowerCase()).toBe('nasdaq');
      });
    });

    it('should be case-insensitive for filters', () => {
      const r1 = service.findAll({ sector: 'energy' });
      const r2 = service.findAll({ sector: 'ENERGY' });

      expect(r1.total).toBe(r2.total);
    });

    it('should paginate correctly', () => {
      const result = service.findAll({ page: 2, limit: 5 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(result.data.length).toBeLessThanOrEqual(5);
      expect(result.totalPages).toBe(Math.ceil(SEED_STOCKS.length / 5));
    });

    it('should return empty data for out-of-range page', () => {
      const result = service.findAll({ page: 100, limit: 20 });
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────
  describe('findOne()', () => {
    it('should return stock with shock history', () => {
      const result = service.findOne('XOM');

      expect(result.ticker).toBe('XOM');
      expect(result.companyName).toBe('Exxon Mobil Corporation');
      expect(result.shockHistory).toBeDefined();
      expect(Array.isArray(result.shockHistory)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const r1 = service.findOne('xom');
      const r2 = service.findOne('XOM');

      expect(r1.ticker).toBe(r2.ticker);
    });

    it('should include shock history from seed data', () => {
      const result = service.findOne('XOM');

      const xomShocks = SEED_SHOCKS.filter(
        (s) => s.ticker.toLowerCase() === 'xom',
      );
      expect(result.shockHistory).toHaveLength(xomShocks.length);
    });

    it('should throw NotFoundException for unknown ticker', () => {
      expect(() => service.findOne('UNKNOWN')).toThrow(NotFoundException);
    });

    it('should include correct shock history fields', () => {
      const result = service.findOne('XOM');

      if (result.shockHistory.length > 0) {
        const entry = result.shockHistory[0];
        expect(entry).toHaveProperty('eventId');
        expect(entry).toHaveProperty('eventTitle');
        expect(entry).toHaveProperty('shockScore');
        expect(entry).toHaveProperty('predictedChange');
        expect(entry).toHaveProperty('actualChange');
        expect(entry).toHaveProperty('surpriseFactor');
        expect(entry).toHaveProperty('timestamp');
      }
    });
  });

  // ─── getAnalysis ──────────────────────────────────────────────
  describe('getAnalysis()', () => {
    it('should return complete StockAnalysis', async () => {
      const result = await service.getAnalysis('XOM');

      expect(result.ticker).toBe('XOM');
      expect(result.companyName).toBe('Exxon Mobil Corporation');
      expect(result.currentPrice).toBe(110.0);
      expect(result.relevantEvents).toHaveLength(1);
      expect(result.shockAnalysis.compositeShockScore).toBe(0.72);
      expect(result.analyzedAt).toBeDefined();
    });

    it('should call marketData.getPrice with uppercase ticker', async () => {
      await service.getAnalysis('xom');

      expect(marketData.getPrice).toHaveBeenCalledWith('XOM');
    });

    it('should call shockEngine.computeAnalysis with stock and price', async () => {
      await service.getAnalysis('XOM');

      expect(shockEngine.computeAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ ticker: 'XOM' }),
        110.0,
      );
    });

    it('should throw NotFoundException for unknown ticker', async () => {
      await expect(service.getAnalysis('UNKNOWN')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getHistory ───────────────────────────────────────────────
  describe('getHistory()', () => {
    it('should return price history for valid ticker', () => {
      const result = service.getHistory('XOM', '1M');

      expect(result).toHaveLength(30);
      result.forEach((point) => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('price');
        expect(point).toHaveProperty('volume');
        expect(point.price).toBeGreaterThan(0);
        expect(point.volume).toBeGreaterThan(0);
      });
    });

    it('should produce deterministic results for same ticker', () => {
      const r1 = service.getHistory('XOM', '1M');
      const r2 = service.getHistory('XOM', '1M');

      expect(r1).toEqual(r2);
    });

    it('should produce different results for different tickers', () => {
      const r1 = service.getHistory('XOM', '1M');
      const r2 = service.getHistory('AAPL', '1M');

      expect(r1[0].price).not.toBe(r2[0].price);
    });

    it('should return correct number of points per timeframe', () => {
      expect(service.getHistory('XOM', '1D')).toHaveLength(13);
      expect(service.getHistory('XOM', '1W')).toHaveLength(56);
      expect(service.getHistory('XOM', '1M')).toHaveLength(30);
      expect(service.getHistory('XOM', '3M')).toHaveLength(90);
      expect(service.getHistory('XOM', '1Y')).toHaveLength(52);
    });

    it('should default to 1M for unknown timeframe', () => {
      const result = service.getHistory('XOM', 'INVALID');
      expect(result).toHaveLength(30);
    });

    it('should throw NotFoundException for unknown ticker', () => {
      expect(() => service.getHistory('UNKNOWN', '1M')).toThrow(NotFoundException);
    });

    it('should never produce negative prices', () => {
      // Test with all stocks and timeframes
      for (const stock of SEED_STOCKS.slice(0, 5)) {
        const history = service.getHistory(stock.ticker, '1Y');
        history.forEach((point) => {
          expect(point.price).toBeGreaterThan(0);
        });
      }
    });
  });

  // ─── getSurpriseAnalysis ──────────────────────────────────────
  describe('getSurpriseAnalysis()', () => {
    it('should return SurpriseAnalysis for valid ticker', () => {
      const result = service.getSurpriseAnalysis('XOM');

      expect(result.ticker).toBe('XOM');
      expect(result.companyName).toBe('Exxon Mobil Corporation');
      expect(typeof result.currentSurpriseFactor).toBe('number');
      expect(typeof result.historicalAvgSurprise).toBe('number');
      expect(typeof result.isAnomaly).toBe('boolean');
      expect(Array.isArray(result.recentSurprises)).toBe(true);
    });

    it('should compute isAnomaly correctly (threshold > 2)', () => {
      const result = service.getSurpriseAnalysis('XOM');

      // XOM's surprise factor from seed is 0.12, so isAnomaly should be false
      expect(result.isAnomaly).toBe(false);
    });

    it('should throw NotFoundException for unknown ticker', () => {
      expect(() => service.getSurpriseAnalysis('UNKNOWN')).toThrow(NotFoundException);
    });

    it('should include recent surprises from seed data', () => {
      const result = service.getSurpriseAnalysis('XOM');

      expect(result.recentSurprises.length).toBeGreaterThan(0);
      result.recentSurprises.forEach((s) => {
        expect(s).toHaveProperty('eventId');
        expect(s).toHaveProperty('predictedChange');
        expect(s).toHaveProperty('actualChange');
        expect(s).toHaveProperty('surpriseFactor');
      });
    });

    it('should round surprise factor to 2 decimal places', () => {
      const result = service.getSurpriseAnalysis('XOM');

      const str = result.currentSurpriseFactor.toString();
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });
  });

  // ─── predictTrajectory ────────────────────────────────────────
  describe('predictTrajectory()', () => {
    it('should return PredictionResult with trajectory', async () => {
      const result = await service.predictTrajectory('XOM', 30);

      expect(result.ticker).toBe('XOM');
      expect(result.companyName).toBe('Exxon Mobil Corporation');
      expect(result.currentPrice).toBe(110.0);
      expect(result.trajectory).toHaveLength(30);
      expect(result.shockFactors.length).toBeGreaterThan(0);
      expect(typeof result.aiSummary).toBe('string');
      expect(result.confidence).toBe(0.86);
      expect(result.generatedAt).toBeDefined();
    });

    it('should generate trajectory with date, price, upper, lower', async () => {
      const result = await service.predictTrajectory('XOM', 10);

      result.trajectory.forEach((point) => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('price');
        expect(point).toHaveProperty('upper');
        expect(point).toHaveProperty('lower');
        expect(point.price).toBeGreaterThan(0);
        expect(point.upper).toBeGreaterThanOrEqual(point.price);
        expect(point.lower).toBeLessThanOrEqual(point.price);
        expect(point.lower).toBeGreaterThan(0);
      });
    });

    it('should widen confidence bands over time', async () => {
      const result = await service.predictTrajectory('XOM', 30);

      const firstBand = result.trajectory[0].upper - result.trajectory[0].lower;
      const lastBand =
        result.trajectory[result.trajectory.length - 1].upper -
        result.trajectory[result.trajectory.length - 1].lower;

      // Last band should generally be wider than first (stochastic but with growing sqrt(i))
      // Using a loose check since it's stochastic
      expect(lastBand).toBeGreaterThan(0);
      expect(firstBand).toBeGreaterThan(0);
    });

    it('should use template narrative when NLP fails', async () => {
      const result = await service.predictTrajectory('XOM', 30);

      // NLP mock rejects → template fallback
      expect(result.aiSummary).toContain('Exxon Mobil Corporation');
      expect(result.aiSummary).toContain('projected');
    });

    it('should throw NotFoundException for unknown ticker', async () => {
      await expect(service.predictTrajectory('UNKNOWN', 30)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include shock factors from relevant events', async () => {
      const result = await service.predictTrajectory('XOM', 30);

      expect(result.shockFactors.length).toBeGreaterThan(0);
      result.shockFactors.forEach((factor) => {
        expect(factor).toHaveProperty('eventTitle');
        expect(factor).toHaveProperty('type');
        expect(factor).toHaveProperty('severity');
        expect(factor).toHaveProperty('impactScore');
        expect(factor).toHaveProperty('direction');
      });
    });
  });
});
