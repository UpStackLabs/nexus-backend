import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MarketDataService } from './market-data.service.js';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Helper: build a Yahoo v8 chart response with quote in meta */
function yahooChartResponse(symbol: string, price: number, prevClose: number) {
  return {
    data: {
      chart: {
        result: [{
          meta: {
            symbol,
            regularMarketPrice: price,
            chartPreviousClose: prevClose,
            regularMarketDayHigh: price + 1,
            regularMarketDayLow: price - 1,
          },
          timestamp: [Math.floor(Date.now() / 1000)],
          indicators: {
            quote: [{
              open: [prevClose],
              high: [price + 1],
              low: [price - 1],
              close: [price],
              volume: [1000000],
            }],
          },
        }],
      },
    },
  };
}

describe('MarketDataService', () => {
  let service: MarketDataService;
  let gateway: jest.Mocked<Partial<ShockGlobeGateway>>;
  let configGet: jest.Mock;

  // ─── Seed fallback (Yahoo fails) ──────────────────────────────
  describe('seed fallback', () => {
    beforeEach(async () => {
      configGet = jest.fn().mockReturnValue(undefined);
      gateway = { emitPriceUpdate: jest.fn() };
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
      await service.onModuleInit();
    });

    afterEach(() => jest.clearAllMocks());

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return seed data when Yahoo fails', async () => {
      const result = await service.getPrice('XOM');
      expect(result.ticker).toBe('XOM');
      expect(result.source).toBe('seed');
    });

    it('should return zero for unknown ticker', async () => {
      const result = await service.getPrice('UNKNOWN');
      expect(result.price).toBe(0);
      expect(result.source).toBe('seed');
    });
  });

  // ─── Yahoo Finance v8 chart ───────────────────────────────────
  describe('Yahoo Finance', () => {
    beforeEach(async () => {
      configGet = jest.fn().mockReturnValue(undefined);
      gateway = { emitPriceUpdate: jest.fn() };

      // Mock: each call returns based on the URL ticker
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/chart/XOM')) {
          return yahooChartResponse('XOM', 147.29, 150.97);
        }
        if (typeof url === 'string' && url.includes('/chart/AAPL')) {
          return yahooChartResponse('AAPL', 264.59, 260.58);
        }
        // Return valid but empty for other tickers
        return yahooChartResponse(url.split('/chart/')[1]?.split('?')[0] ?? 'X', 100, 99);
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
      await service.onModuleInit();
    });

    afterEach(() => jest.clearAllMocks());

    it('should return Yahoo price after batch refresh', async () => {
      const result = await service.getPrice('XOM');
      expect(result.source).toBe('yahoo');
      expect(result.price).toBe(147.29);
      expect(result.previousClose).toBe(150.97);
    });

    it('should return multiple prices from batch', async () => {
      const results = await service.getPrices(['XOM', 'AAPL']);
      expect(results).toHaveLength(2);
      expect(results[0].price).toBe(147.29);
      expect(results[1].price).toBe(264.59);
    });

    it('should compute change from previous close', async () => {
      const result = await service.getPrice('XOM');
      expect(result.change).toBeCloseTo(147.29 - 150.97, 1);
      expect(result.changePercent).toBeCloseTo(((147.29 - 150.97) / 150.97) * 100, 1);
    });

    it('should fall back to seed when Yahoo returns empty', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { chart: { result: [{ meta: { symbol: 'ZZZ' } }] } },
      });
      const result = await service.getPrice('ZZZ_INVALID');
      expect(result.source).toBe('seed');
    });
  });

  // ─── Historical candles ───────────────────────────────────────
  describe('getHistoricalCandles()', () => {
    beforeEach(async () => {
      configGet = jest.fn().mockReturnValue(undefined);
      gateway = { emitPriceUpdate: jest.fn() };
      mockedAxios.get.mockRejectedValue(new Error('skip'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MarketDataService,
          { provide: ConfigService, useValue: { get: configGet } },
          { provide: ShockGlobeGateway, useValue: gateway },
        ],
      }).compile();

      service = module.get<MarketDataService>(MarketDataService);
      await service.onModuleInit();
      mockedAxios.get.mockClear();
    });

    afterEach(() => jest.clearAllMocks());

    it('should return candle data from Yahoo chart', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          chart: {
            result: [{
              meta: { symbol: 'XOM', regularMarketPrice: 147, chartPreviousClose: 150 },
              timestamp: [1700000000, 1700086400],
              indicators: {
                quote: [{
                  open: [110, 114], high: [115, 117],
                  low: [109, 113], close: [114, 116],
                  volume: [1000000, 1200000],
                }],
              },
            }],
          },
        },
      });

      const result = await service.getHistoricalCandles('XOM', '1M');
      expect(result).toHaveLength(2);
      expect(result![0].close).toBe(114);
      expect(result![0].volume).toBe(1000000);
    });

    it('should return null when both Yahoo and Polygon fail', async () => {
      mockedAxios.get.mockRejectedValue(new Error('fail'));
      const result = await service.getHistoricalCandles('XOM', '1M');
      expect(result).toBeNull();
    });

    it('should cache candle data', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          chart: {
            result: [{
              meta: { symbol: 'XOM', regularMarketPrice: 147, chartPreviousClose: 150 },
              timestamp: [1700000000],
              indicators: {
                quote: [{ open: [110], high: [115], low: [109], close: [114], volume: [1000000] }],
              },
            }],
          },
        },
      });

      await service.getHistoricalCandles('XOM', '1M');
      mockedAxios.get.mockClear();

      const result2 = await service.getHistoricalCandles('XOM', '1M');
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(result2).toHaveLength(1);
    });
  });
});
