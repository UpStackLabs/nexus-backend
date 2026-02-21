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

    describe('getHistoricalCandles()', () => {
      it('should return null when no Polygon key', async () => {
        const result = await service.getHistoricalCandles('XOM', '1M');
        expect(result).toBeNull();
      });
    });
  });

  // ─── Finnhub API (primary) ─────────────────────────────────────
  describe('Finnhub API', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'FINNHUB_API_KEY') return 'finnhub-test-key';
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

    it('should return Finnhub price as primary source', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { c: 115.50, d: 2.10, dp: 1.85, h: 116.00, l: 113.50, o: 114.00, pc: 113.40, t: 1700000000 },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('finnhub');
      expect(result.price).toBe(115.50);
      expect(result.change).toBe(2.10);
      expect(result.changePercent).toBe(1.85);
      expect(result.open).toBe(114.00);
      expect(result.high).toBe(116.00);
      expect(result.low).toBe(113.50);
      expect(result.previousClose).toBe(113.40);
    });

    it('should fall through when Finnhub returns c=0 (invalid symbol)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 },
      });

      const result = await service.getPrice('XOM');

      // Should fall through to seed since no other keys configured
      expect(result.source).toBe('seed');
    });

    it('should fall through to seed when Finnhub errors', async () => {
      mockedAxios.get.mockRejectedValue(new Error('429 Too Many Requests'));

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('seed');
    });
  });

  // ─── Finnhub + Polygon cascade ────────────────────────────────
  describe('Finnhub + Polygon cascade', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'FINNHUB_API_KEY') return 'finnhub-test-key';
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

    it('should prefer Finnhub over Polygon', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { c: 115.50, d: 2.10, dp: 1.85, h: 116.00, l: 113.50, o: 114.00, pc: 113.40, t: 1700000000 },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('finnhub');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://finnhub.io/api/v1/quote',
        expect.objectContaining({ params: { symbol: 'XOM', token: 'finnhub-test-key' } }),
      );
    });

    it('should fall through to Polygon when Finnhub fails', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Finnhub timeout'))
        .mockResolvedValueOnce({
          data: { results: [{ o: 114.00, h: 116.00, l: 113.50, c: 115.50 }] },
        });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('polygon');
      expect(result.price).toBe(115.50);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should cascade through all providers to seed', async () => {
      mockedAxios.get.mockRejectedValue(new Error('All fail'));

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('seed');
      // Should have tried Finnhub + Polygon /prev (2 calls)
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
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

    it('should return Polygon price from /prev endpoint', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: [{ o: 114.00, h: 116.00, l: 113.50, c: 115.50 }] },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('polygon');
      expect(result.price).toBe(115.50);
      expect(result.ticker).toBe('XOM');
      expect(result.open).toBe(114.00);
      expect(result.high).toBe(116.00);
      expect(result.low).toBe(113.50);
    });

    it('should compute change vs seed baseline', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: [{ o: 114.00, h: 116.00, l: 113.50, c: 115.50 }] },
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

    it('should fall through when Polygon returns no results', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: [] },
      });

      const result = await service.getPrice('XOM');

      expect(result.source).toBe('seed');
    });

    it('should use ohlcCache on subsequent calls without API hit', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { results: [{ o: 114.00, h: 116.00, l: 113.50, c: 115.50 }] },
      });
      await service.getPrice('XOM');
      mockedAxios.get.mockClear();

      (service as any).priceCache.clear();
      const result = await service.getPrice('XOM');

      expect(result.source).toBe('polygon');
      expect(result.price).toBe(115.50);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  // ─── getHistoricalCandles ─────────────────────────────────────
  describe('getHistoricalCandles()', () => {
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

    it('should return candle data from Polygon /range', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          results: [
            { t: 1700000000000, o: 110, h: 115, l: 109, c: 114, v: 1000000 },
            { t: 1700086400000, o: 114, h: 117, l: 113, c: 116, v: 1200000 },
          ],
        },
      });

      const result = await service.getHistoricalCandles('XOM', '1M');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        date: expect.any(String),
        open: 110,
        high: 115,
        low: 109,
        close: 114,
        volume: 1000000,
      });
    });

    it('should return null when Polygon returns no results', async () => {
      mockedAxios.get.mockResolvedValue({ data: { results: [] } });

      const result = await service.getHistoricalCandles('XOM', '1M');
      expect(result).toBeNull();
    });

    it('should return null on API error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const result = await service.getHistoricalCandles('XOM', '1M');
      expect(result).toBeNull();
    });

    it('should cache candle data', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          results: [
            { t: 1700000000000, o: 110, h: 115, l: 109, c: 114, v: 1000000 },
          ],
        },
      });

      const result1 = await service.getHistoricalCandles('XOM', '1M');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);

      mockedAxios.get.mockClear();

      const result2 = await service.getHistoricalCandles('XOM', '1M');
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(result2).toEqual(result1);
    });

    it('should use different cache entries per timeframe', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          results: [
            { t: 1700000000000, o: 110, h: 115, l: 109, c: 114, v: 1000000 },
          ],
        },
      });

      await service.getHistoricalCandles('XOM', '1M');
      await service.getHistoricalCandles('XOM', '1W');

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
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
      jest.spyOn(service as any, 'isMarketHours').mockReturnValue(true);

      await service.pollMarketData();

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

  // ─── pollMarketData with Finnhub (all tickers) ────────────────
  describe('pollMarketData() with Finnhub key', () => {
    beforeEach(async () => {
      configGet = jest.fn((key: string) => {
        if (key === 'FINNHUB_API_KEY') return 'finnhub-key';
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

    it('should fetch all tickers when Finnhub key is present', async () => {
      jest.spyOn(service as any, 'isMarketHours').mockReturnValue(true);
      mockedAxios.get.mockResolvedValue({
        data: { c: 100, d: 1, dp: 1.0, h: 101, l: 99, o: 99.5, pc: 99, t: 1700000000 },
      });

      await service.pollMarketData();

      expect(gateway.emitPriceUpdate).toHaveBeenCalledTimes(SEED_STOCKS.length);
    });
  });
});
