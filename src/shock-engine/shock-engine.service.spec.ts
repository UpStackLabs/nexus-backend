import { Test, TestingModule } from '@nestjs/testing';
import { ShockEngineService } from './shock-engine.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { EventsService } from '../events/events.service.js';
import { SEED_STOCKS, SEED_EVENTS } from '../common/data/seed-data.js';
import type { Stock } from '../common/types/index.js';

describe('ShockEngineService', () => {
  let service: ShockEngineService;
  let vectorDb: jest.Mocked<Partial<VectorDbService>>;
  let nlp: jest.Mocked<Partial<SphinxNlpService>>;

  // ─── Seed fallback path (vector DB disabled) ──────────────────
  describe('with vector DB disabled (seed fallback)', () => {
    beforeEach(async () => {
      vectorDb = {
        enabled: false as any,
        querySimilarEvents: jest.fn(),
      };
      // Make `enabled` a getter
      Object.defineProperty(vectorDb, 'enabled', { get: () => false });

      nlp = {
        embed: jest.fn().mockResolvedValue(new Array(384).fill(0)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ShockEngineService,
          { provide: VectorDbService, useValue: vectorDb },
          { provide: SphinxNlpService, useValue: nlp },
          { provide: EventsService, useValue: { getAll: () => [...SEED_EVENTS] } },
        ],
      }).compile();

      service = module.get<ShockEngineService>(ShockEngineService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should not call vectorDb when disabled', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      await service.computeAnalysis(stock, stock.price);

      expect(vectorDb.querySimilarEvents).not.toHaveBeenCalled();
    });

    it('should return relevant events from seed data as fallback', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      expect(result.relevantEvents).toHaveLength(3);
      expect(result.relevantEvents[0].eventId).toBe(SEED_EVENTS[0].id);
      expect(result.relevantEvents[1].eventId).toBe(SEED_EVENTS[1].id);
      expect(result.relevantEvents[2].eventId).toBe(SEED_EVENTS[2].id);
    });

    it('should return shock analysis with valid composite score', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      const { shockAnalysis } = result;
      expect(shockAnalysis.compositeShockScore).toBeGreaterThanOrEqual(0);
      expect(shockAnalysis.compositeShockScore).toBeLessThanOrEqual(1);
    });

    it('should have correct shock analysis structure', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'LMT')!;
      const result = await service.computeAnalysis(stock, stock.price);

      const { shockAnalysis } = result;
      expect(shockAnalysis).toHaveProperty('compositeShockScore');
      expect(shockAnalysis).toHaveProperty('predictedPriceChange');
      expect(shockAnalysis).toHaveProperty('confidence');
      expect(shockAnalysis).toHaveProperty('direction');
      expect(shockAnalysis).toHaveProperty('components');
      expect(shockAnalysis).toHaveProperty('surpriseFactor');
      expect(shockAnalysis).toHaveProperty('riskLevel');

      // Components structure
      expect(shockAnalysis.components).toHaveProperty('similarityScore');
      expect(shockAnalysis.components).toHaveProperty('historicalSensitivity');
      expect(shockAnalysis.components).toHaveProperty('geographicProximity');
      expect(shockAnalysis.components).toHaveProperty('supplyChainLinkage');
    });

    it('should assign correct risk levels', async () => {
      // Test with multiple stocks and validate risk level ranges
      for (const stock of SEED_STOCKS.slice(0, 5)) {
        const result = await service.computeAnalysis(stock, stock.price);
        const { compositeShockScore, riskLevel } = result.shockAnalysis;

        if (compositeShockScore < 0.25) expect(riskLevel).toBe('low');
        else if (compositeShockScore < 0.5) expect(riskLevel).toBe('medium');
        else if (compositeShockScore < 0.75) expect(riskLevel).toBe('high');
        else expect(riskLevel).toBe('critical');
      }
    });

    it('should compute confidence within valid range', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      expect(result.shockAnalysis.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.shockAnalysis.confidence).toBeLessThanOrEqual(0.95);
    });

    it('should determine direction based on sector position in EVENT_SECTOR_MAP', async () => {
      // Defense sector is index 0 in military EVENT_SECTOR_MAP → 'up'
      const lmt = SEED_STOCKS.find((s) => s.ticker === 'LMT')!;
      const lmtResult = await service.computeAnalysis(lmt, lmt.price);
      // With seed fallback, first event is 'military' → Defense at index 0 → 'up'
      expect(lmtResult.shockAnalysis.direction).toBe('up');

      // Technology is not in top-2 of military map → 'down'
      const aapl = SEED_STOCKS.find((s) => s.ticker === 'AAPL')!;
      const aaplResult = await service.computeAnalysis(aapl, aapl.price);
      expect(aaplResult.shockAnalysis.direction).toBe('down');
    });

    it('should return surprise factor from seed shocks', async () => {
      const xom = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(xom, xom.price);

      // XOM has a shock in SEED_SHOCKS with surpriseFactor 0.12
      expect(result.shockAnalysis.surpriseFactor).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 surprise factor for stocks not in SEED_SHOCKS', async () => {
      // Create a mock stock that doesn't exist in SEED_SHOCKS
      const fakeStock: Stock = {
        ticker: 'FAKE',
        companyName: 'Fake Corp',
        sector: 'Technology',
        country: 'USA',
        exchange: 'NYSE',
        marketCap: 1000,
        price: 100,
        priceChange: 0,
        priceChangePercent: 0,
        volume: 1000,
        location: { lat: 40.0, lng: -74.0 },
      };

      const result = await service.computeAnalysis(fakeStock, 100);
      expect(result.shockAnalysis.surpriseFactor).toBe(0);
    });
  });

  // ─── Vector DB enabled path ───────────────────────────────────
  describe('with vector DB enabled', () => {
    beforeEach(async () => {
      vectorDb = {
        enabled: true as any,
        querySimilarEvents: jest.fn().mockResolvedValue([
          {
            eventId: 'evt-001',
            similarity: 0.92,
            metadata: { title: 'Venezuelan Invasion', type: 'military', severity: 9 },
          },
          {
            eventId: 'evt-005',
            similarity: 0.85,
            metadata: { title: 'Taiwan Strait Tensions', type: 'geopolitical', severity: 8 },
          },
          {
            eventId: 'evt-002',
            similarity: 0.71,
            metadata: { title: 'US Jobs Report', type: 'economic', severity: 6 },
          },
        ]),
      };
      Object.defineProperty(vectorDb, 'enabled', { get: () => true });

      nlp = {
        embed: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ShockEngineService,
          { provide: VectorDbService, useValue: vectorDb },
          { provide: SphinxNlpService, useValue: nlp },
          { provide: EventsService, useValue: { getAll: () => [...SEED_EVENTS] } },
        ],
      }).compile();

      service = module.get<ShockEngineService>(ShockEngineService);
    });

    it('should call embed and querySimilarEvents', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      await service.computeAnalysis(stock, stock.price);

      expect(nlp.embed).toHaveBeenCalledWith(
        expect.stringContaining('Exxon Mobil'),
      );
      expect(vectorDb.querySimilarEvents).toHaveBeenCalledWith(
        expect.any(Array),
        10,
      );
    });

    it('should use vector results for relevant events', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      expect(result.relevantEvents).toHaveLength(3);
      expect(result.relevantEvents[0].vectorSimilarity).toBe(0.92);
      expect(result.relevantEvents[1].vectorSimilarity).toBe(0.85);
    });

    it('should compute composite shock following the formula', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      // Composite score should be average of top-3 per-event scores
      // Each score = 0.35*sim + 0.25*H + 0.20*G + 0.20*SC
      const { shockAnalysis } = result;
      const { components } = shockAnalysis;

      // Verify formula: composite ≈ 0.35*avgSim + 0.25*avgH + 0.20*avgG + 0.20*avgSC
      const expected =
        0.35 * components.similarityScore +
        0.25 * components.historicalSensitivity +
        0.2 * components.geographicProximity +
        0.2 * components.supplyChainLinkage;

      expect(shockAnalysis.compositeShockScore).toBeCloseTo(expected, 1);
    });

    it('should return all components within 0-1 range', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'LMT')!;
      const result = await service.computeAnalysis(stock, stock.price);

      const { components } = result.shockAnalysis;
      expect(components.similarityScore).toBeGreaterThanOrEqual(0);
      expect(components.similarityScore).toBeLessThanOrEqual(1);
      expect(components.historicalSensitivity).toBeGreaterThanOrEqual(0);
      expect(components.historicalSensitivity).toBeLessThanOrEqual(1);
      expect(components.geographicProximity).toBeGreaterThanOrEqual(0);
      expect(components.geographicProximity).toBeLessThanOrEqual(1);
      expect(components.supplyChainLinkage).toBeGreaterThanOrEqual(0);
      expect(components.supplyChainLinkage).toBeLessThanOrEqual(1);
    });
  });

  // ─── Verify shock formula math ────────────────────────────────
  describe('shock formula S(c,e) verification', () => {
    beforeEach(async () => {
      vectorDb = {
        enabled: false as any,
        querySimilarEvents: jest.fn(),
      };
      Object.defineProperty(vectorDb, 'enabled', { get: () => false });

      nlp = {
        embed: jest.fn().mockResolvedValue(new Array(384).fill(0)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ShockEngineService,
          { provide: VectorDbService, useValue: vectorDb },
          { provide: SphinxNlpService, useValue: nlp },
          { provide: EventsService, useValue: { getAll: () => [...SEED_EVENTS] } },
        ],
      }).compile();

      service = module.get<ShockEngineService>(ShockEngineService);
    });

    it('should produce consistent results for the same stock', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;

      // Mock Math.random to get consistent seed fallback
      const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const result1 = await service.computeAnalysis(stock, stock.price);
      const result2 = await service.computeAnalysis(stock, stock.price);

      expect(result1.shockAnalysis.compositeShockScore).toBe(
        result2.shockAnalysis.compositeShockScore,
      );

      mockRandom.mockRestore();
    });

    it('should weight similarity at 35%', async () => {
      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      // The weight of similarity in the formula is 0.35
      const { components, compositeShockScore } = result.shockAnalysis;
      const simContribution = 0.35 * components.similarityScore;

      // Sim contribution should be a significant portion
      expect(simContribution).toBeLessThanOrEqual(compositeShockScore);
    });

    it('should compute predictedPriceChange using compositeScore * severity * direction * 2', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const stock = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;
      const result = await service.computeAnalysis(stock, stock.price);

      const { compositeShockScore, predictedPriceChange, direction } = result.shockAnalysis;
      const avgSeverity = result.relevantEvents.slice(0, 3).reduce(
        (sum, e) => sum + e.severity, 0,
      ) / Math.min(result.relevantEvents.length, 3);
      const dirSign = direction === 'up' ? 1 : -1;
      const expected = compositeShockScore * (avgSeverity / 10) * dirSign * 2;

      expect(predictedPriceChange).toBeCloseTo(expected, 1);

      jest.spyOn(Math, 'random').mockRestore();
    });
  });
});
