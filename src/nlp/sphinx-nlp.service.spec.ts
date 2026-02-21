import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SphinxNlpService } from './sphinx-nlp.service.js';
import axios from 'axios';

jest.mock('axios');
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: {
        create: jest.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      },
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    type: 'military',
                    severity: 8,
                    location: 'Caracas, Venezuela',
                    affectedCountries: ['VE', 'CO'],
                    affectedSectors: ['Energy', 'Defense'],
                    affectedTickers: ['XOM', 'LMT'],
                  }),
                },
              },
            ],
          }),
        },
      },
    })),
  };
});

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SphinxNlpService', () => {
  let service: SphinxNlpService;

  // ─── No API keys (stub mode) ──────────────────────────────────
  describe('stub mode (no keys configured)', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SphinxNlpService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<SphinxNlpService>(SphinxNlpService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    describe('embed()', () => {
      it('should return a 384-dim zero vector as stub', async () => {
        const result = await service.embed('test text');

        expect(result).toHaveLength(384);
        expect(result.every((v) => v === 0)).toBe(true);
      });

      it('should return consistent stub output for any input', async () => {
        const result1 = await service.embed('foo');
        const result2 = await service.embed('bar');

        expect(result1).toEqual(result2);
        expect(result1).toHaveLength(384);
      });
    });

    describe('classifyEvent()', () => {
      it('should return stub classification with default values', async () => {
        const result = await service.classifyEvent('Some news about conflict');

        expect(result).toEqual({
          type: 'geopolitical',
          severity: 5,
          location: 'Unknown',
          affectedCountries: [],
          affectedSectors: [],
          affectedTickers: [],
        });
      });

      it('should return the same stub regardless of input', async () => {
        const r1 = await service.classifyEvent('Military invasion');
        const r2 = await service.classifyEvent('Economic crisis');

        expect(r1).toEqual(r2);
      });
    });

    describe('generateText()', () => {
      it('should throw error when no LLM provider available', async () => {
        await expect(service.generateText('Write a summary')).rejects.toThrow(
          'No LLM provider available',
        );
      });
    });

    describe('predictShock()', () => {
      it('should use heuristic fallback and return valid prediction', async () => {
        const result = await service.predictShock({
          severity: 8,
          eventType: 'military',
          sectorRelevance: 0.9,
          geographicProximity: 0.7,
        });

        expect(result).toHaveProperty('predictedChange');
        expect(result).toHaveProperty('confidence');
        expect(typeof result.predictedChange).toBe('number');
        expect(typeof result.confidence).toBe('number');
      });

      it('should compute correct heuristic values', async () => {
        const features = {
          severity: 10,
          eventType: 'military',
          sectorRelevance: 1.0,
          geographicProximity: 1.0,
        };
        const result = await service.predictShock(features);

        // magnitude = 10 * 0.3 * 1.0 * (0.5 + 0.5 * 1.0) = 3.0
        // predictedChange = -3.0
        expect(result.predictedChange).toBe(-3.0);
        // confidence = 0.6 + 0.1 * 1.0 = 0.7
        expect(result.confidence).toBe(0.7);
      });

      it('should compute correct heuristic for low severity events', async () => {
        const features = {
          severity: 2,
          eventType: 'economic',
          sectorRelevance: 0.5,
          geographicProximity: 0.3,
        };
        const result = await service.predictShock(features);

        // magnitude = 2 * 0.3 * 0.5 * (0.5 + 0.5 * 0.3) = 0.195
        const expectedMag = 2 * 0.3 * 0.5 * (0.5 + 0.5 * 0.3);
        expect(result.predictedChange).toBeCloseTo(-expectedMag, 5);
        // confidence = 0.6 + 0.1 * 0.5 = 0.65
        expect(result.confidence).toBeCloseTo(0.65, 5);
      });

      it('should always return negative predictedChange in heuristic', async () => {
        const result = await service.predictShock({
          severity: 5,
          eventType: 'policy',
          sectorRelevance: 0.8,
          geographicProximity: 0.5,
        });

        expect(result.predictedChange).toBeLessThan(0);
      });
    });
  });

  // ─── OpenAI mode ──────────────────────────────────────────────
  describe('OpenAI mode', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SphinxNlpService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'OPENAI_API_KEY') return 'test-key';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<SphinxNlpService>(SphinxNlpService);
    });

    it('should be defined with OpenAI client', () => {
      expect(service).toBeDefined();
    });

    describe('embed()', () => {
      it('should return 1536-dim OpenAI embedding', async () => {
        const result = await service.embed('test text');

        expect(result).toHaveLength(1536);
        expect(result[0]).toBe(0.1);
      });
    });

    describe('classifyEvent()', () => {
      it('should return parsed OpenAI classification', async () => {
        const result = await service.classifyEvent('Military invasion in Venezuela');

        expect(result.type).toBe('military');
        expect(result.severity).toBe(8);
        expect(result.location).toBe('Caracas, Venezuela');
        expect(result.affectedCountries).toContain('VE');
        expect(result.affectedSectors).toContain('Energy');
        expect(result.affectedTickers).toContain('XOM');
      });
    });

    describe('generateText()', () => {
      it('should not throw with OpenAI key configured', async () => {
        // The mock returns a valid response
        await expect(service.generateText('Write a summary')).resolves.toBeDefined();
      });
    });
  });

  // ─── Custom model server mode ─────────────────────────────────
  describe('custom model server mode', () => {
    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({ data: { status: 'ok' } });
      mockedAxios.post.mockImplementation((url: string) => {
        if (url.includes('/embed')) {
          return Promise.resolve({
            data: { embedding: new Array(384).fill(0.5) },
          });
        }
        if (url.includes('/classify')) {
          return Promise.resolve({
            data: {
              type: 'economic',
              severity: 7,
              location: 'Washington DC',
              affectedCountries: ['US'],
              affectedSectors: ['Finance'],
              affectedTickers: ['JPM'],
            },
          });
        }
        if (url.includes('/predict-shock')) {
          return Promise.resolve({
            data: { predicted_change: -2.5, confidence: 0.85 },
          });
        }
        return Promise.reject(new Error('Unknown endpoint'));
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SphinxNlpService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'MODEL_SERVER_URL') return 'http://localhost:8000';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<SphinxNlpService>(SphinxNlpService);
      // Wait for the health check in the constructor
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('embed()', () => {
      it('should return 384-dim embedding from custom server', async () => {
        const result = await service.embed('test text');

        expect(result).toHaveLength(384);
        expect(result[0]).toBe(0.5);
      });

      it('should fall back to stub when custom server embed fails', async () => {
        mockedAxios.post.mockRejectedValueOnce(new Error('Connection refused'));

        const result = await service.embed('test');

        // Falls back to stub (no OpenAI key in this test)
        expect(result).toHaveLength(384);
        expect(result.every((v) => v === 0)).toBe(true);
      });
    });

    describe('classifyEvent()', () => {
      it('should return classification from custom server', async () => {
        const result = await service.classifyEvent('Jobs report shock');

        expect(result.type).toBe('economic');
        expect(result.severity).toBe(7);
        expect(result.location).toBe('Washington DC');
      });

      it('should fall back to stub when custom server classify fails', async () => {
        mockedAxios.post.mockRejectedValueOnce(new Error('Connection refused'));

        const result = await service.classifyEvent('test');

        // Falls back to stub (no OpenAI key)
        expect(result.type).toBe('geopolitical');
        expect(result.severity).toBe(5);
      });
    });

    describe('predictShock()', () => {
      it('should return prediction from custom server', async () => {
        const result = await service.predictShock({
          severity: 8,
          eventType: 'military',
          sectorRelevance: 0.9,
          geographicProximity: 0.7,
        });

        expect(result.predictedChange).toBe(-2.5);
        expect(result.confidence).toBe(0.85);
      });

      it('should fall back to heuristic when custom server fails', async () => {
        mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

        const result = await service.predictShock({
          severity: 8,
          eventType: 'military',
          sectorRelevance: 0.9,
          geographicProximity: 0.7,
        });

        // Heuristic: magnitude = 8 * 0.3 * 0.9 * (0.5 + 0.5 * 0.7) = 1.836
        const expectedMag = 8 * 0.3 * 0.9 * (0.5 + 0.5 * 0.7);
        expect(result.predictedChange).toBeCloseTo(-expectedMag, 5);
      });
    });
  });
});
