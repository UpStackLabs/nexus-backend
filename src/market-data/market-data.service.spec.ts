import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MarketDataService } from './market-data.service.js';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MarketDataService', () => {
  let service: MarketDataService;
  let gateway: jest.Mocked<Partial<ShockGlobeGateway>>;
  let configGet: jest.Mock;

  // ─── Seed fallback (no API keys) ──────────────────────────────
  describe('seed fallback (no API keys)', () => {
    beforeEach(async () => {
      configGet = jest.fn().mockReturnValue(undefined);
      gateway = { emitPriceUpdate: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    describe('getPrice()', () => {
      it('should return seed data when no API keys configured', async () => {
        const result = await service.getPrice('XOM');

        expect(result.ticker).toBe('XOM');
        expect(result.source).toBe('seed');
        expect(result.price).toBe(107.42);
        expect(result.change).toBe(8.63);
        expect(result.changePercent).toBe(8.73);
      });

      it('should return zero price for unknown ticker', async () => {
        const result = await service.getPrice('UNKNOWN');

        expect(result.ticker).toBe('UNKNOWN');
        expect(result.price).toBe(0);
        expect(result.source).toBe('seed');
      });

      it('should return correct seed data for each known stock', async () => {
        for (const stock of SEED_STOCKS.slice(0, 5)) {
          const result = await service.getPrice(stock.ticker);

          expect(result.ticker).toBe(stock.ticker);
          expect(result.price).toBe(stock.price);
          expect(result.source).toBe('seed');
        }
      });
    });

    describe('getPrices()', () => {
      it('should return prices for multiple tickers', async () => {
        const tickers = ['XOM', 'CVX', 'AAPL'];
        const results = await service.getPrices(tickers);

        expect(results).toHaveLength(3);
        expect(results.map((r) => r.ticker)).toEqual(tickers);
      });

      it('should handle empty ticker list', async () => {
        const results = await service.getPrices([]);
        expect(results).toHaveLength(0);
      });

      it('should batch requests (5 per batch)', async () => {
        const tickers = SEED_STOCKS.slice(0, 8).map((s) => s.ticker);
        const results = await service.getPrices(tickers);

        // All 8 should succeed with seed data
        expect(results).toHaveLength(8);
      });
    });
  });

  // ─── Polygon API ──────────────────────────────────────────────
  describe('Polygon API', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'POLYGON_API_KEY') return 'poly-test-key';
        return undefined;
      });
      gateway = { emitPriceUpdate: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
    });

    afterEach(() => jest.clearAllMocks());

    it('should return Polygon price when available', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: { p: 115.50 } },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('polygon');
      expect(result.price).toBe(115.50);
      expect(result.ticker).toBe('XOM');
    });

    it('should compute change vs seed baseline', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: { p: 115.50 } },
      });

      const result = await service.getPrice('XOM');
      const seed = SEED_STOCKS.find((s) => s.ticker === 'XOM')!;

      expect(result.change).toBeCloseTo(115.50 - seed.price, 2);
      expect(result.changePercent).toBeCloseTo(
        ((115.50 - seed.price) / seed.price) * 100,
        2,
      );
    });

    it('should fall through to seed when Polygon fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Timeout'));

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('seed');
    });

    it('should fall through when Polygon returns no price', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: {} },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('seed');
    });
  });

  // ─── Alpaca API fallback ──────────────────────────────────────
  describe('Alpaca API fallback', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'ALPACA_API_KEY') return 'alpaca-key';
        if (key === 'ALPACA_API_SECRET') return 'alpaca-secret';
        return undefined;
      });
      gateway = { emitPriceUpdate: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
    });

    afterEach(() => jest.clearAllMocks());

    it('should use Alpaca when available', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { trade: { p: 110.00 } },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('alpaca');
      expect(result.price).toBe(110.00);
    });

    it('should fall through to seed when Alpaca fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Unauthorized'));

      const result = await service.getPrice('XOM');
      expect(result.source).toBe('seed');
    });
  });

  // ─── FMP API fallback ─────────────────────────────────────────
  describe('FMP API fallback', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'FMP_API_KEY') return 'fmp-key';
        return undefined;
      });
      gateway = { emitPriceUpdate: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
    });

    afterEach(() => jest.clearAllMocks());

    it('should use FMP when available', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [{ price: 112.00 }],
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('fmp');
      expect(result.price).toBe(112.00);
    });

    it('should fall through to seed when FMP fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Rate limited'));

      const result = await service.getPrice('XOM');
      expect(result.source).toBe('seed');
    });
  });

  // ─── Full cascade ─────────────────────────────────────────────
  describe('full cascade: Polygon → Alpaca → FMP → seed', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'POLYGON_API_KEY') return 'poly-key';
        if (key === 'ALPACA_API_KEY') return 'alpaca-key';
        if (key === 'ALPACA_API_SECRET') return 'alpaca-secret';
        if (key === 'FMP_API_KEY') return 'fmp-key';
        return undefined;
      });
      gateway = { emitPriceUpdate: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
    });

    afterEach(() => jest.clearAllMocks());

    it('should cascade through all providers to seed', async () => {
      // All providers fail
      mockedAxios.get.mockRejectedValue(new Error('All fail'));

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('seed');
      // Should have tried Polygon, Alpaca, and FMP (3 calls)
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should stop at Alpaca when Polygon fails but Alpaca succeeds', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Polygon timeout'))
        .mockResolvedValueOnce({ data: { trade: { p: 111.00 } } });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('alpaca');
      expect(result.price).toBe(111.00);
    });

    it('should stop at FMP when Polygon and Alpaca fail', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Polygon fail'))
        .mockRejectedValueOnce(new Error('Alpaca fail'))
        .mockResolvedValueOnce({ data: [{ price: 113.00 }] });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('fmp');
      expect(result.price).toBe(113.00);
    });
  });

  // ─── pollMarketData ───────────────────────────────────────────
  describe('pollMarketData()', () => {
    beforeEach(async () => {
      configGet = jest.fn().mockReturnValue(undefined);
      gateway = { emitPriceUpdate: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
    });

    it('should emit price updates via gateway during market hours', async () => {
      // Mock isMarketHours to return true
      jest.spyOn(service as any, 'isMarketHours').mockReturnValue(true);

      await service.pollMarketData();

      // Should have emitted for all seed stocks
      expect(gateway.emitPriceUpdate).toHaveBeenCalled();
      expect(gateway.emitPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: expect.any(String),
          price: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });

    it('should not emit updates outside market hours', async () => {
      jest.spyOn(service as any, 'isMarketHours').mockReturnValue(false);

      await service.pollMarketData();

      expect(gateway.emitPriceUpdate).not.toHaveBeenCalled();
    });
  });
});
