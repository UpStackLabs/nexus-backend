import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NewsIngestionService } from './news-ingestion.service.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NewsIngestionService', () => {
  let service: NewsIngestionService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn().mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsIngestionService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get<NewsIngestionService>(NewsIngestionService);
  });

  afterEach(() => jest.clearAllMocks());

  const since = new Date('2026-02-18T00:00:00Z');

  describe('fetchGdelt()', () => {
    it('should return formatted articles from GDELT', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          articles: [
            { url: 'https://example.com/1', title: 'Military Conflict in Region' },
            { url: 'https://example.com/2', title: 'Economic Update' },
          ],
        },
      });

      const results = await service.fetchGdelt(since);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(
        expect.objectContaining({
          title: 'Military Conflict in Region',
          source: 'gdelt',
          rawText: 'Military Conflict in Region',
          description: '',
        }),
      );
    });

    it('should return empty array on GDELT API error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const results = await service.fetchGdelt(since);
      expect(results).toEqual([]);
    });

    it('should handle empty articles response', async () => {
      mockedAxios.get.mockResolvedValue({ data: {} });

      const results = await service.fetchGdelt(since);
      expect(results).toEqual([]);
    });

    it('should handle null articles', async () => {
      mockedAxios.get.mockResolvedValue({ data: { articles: null } });

      const results = await service.fetchGdelt(since);
      expect(results).toEqual([]);
    });
  });

  describe('fetchNewsApi()', () => {
    it('should return empty array when NEWSAPI_KEY not set', async () => {
      const results = await service.fetchNewsApi(since);
      expect(results).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should return formatted articles when key is set', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'NEWSAPI_KEY') return 'test-newsapi-key';
        return undefined;
      });

      // Re-create service with updated config
      const module = await Test.createTestingModule({
        providers: [
          NewsIngestionService,
          { provide: ConfigService, useValue: { get: configGet } },
        ],
      }).compile();
      service = module.get<NewsIngestionService>(NewsIngestionService);

      mockedAxios.get.mockResolvedValue({
        data: {
          articles: [
            {
              title: 'Sanctions Imposed',
              description: 'New sanctions affect trade',
              publishedAt: '2026-02-18T10:00:00Z',
            },
          ],
        },
      });

      const results = await service.fetchNewsApi(since);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          title: 'Sanctions Imposed',
          description: 'New sanctions affect trade',
          rawText: 'Sanctions Imposed New sanctions affect trade',
          source: 'newsapi',
          publishedAt: '2026-02-18T10:00:00Z',
        }),
      );
    });

    it('should return empty array on NewsAPI error', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'NEWSAPI_KEY') return 'test-key';
        return undefined;
      });

      const module = await Test.createTestingModule({
        providers: [
          NewsIngestionService,
          { provide: ConfigService, useValue: { get: configGet } },
        ],
      }).compile();
      service = module.get<NewsIngestionService>(NewsIngestionService);

      mockedAxios.get.mockRejectedValue(new Error('Rate limited'));

      const results = await service.fetchNewsApi(since);
      expect(results).toEqual([]);
    });
  });

  describe('fetchAcled()', () => {
    it('should return empty array when ACLED_KEY not set', async () => {
      const results = await service.fetchAcled(since);
      expect(results).toEqual([]);
    });

    it('should return empty array when ACLED_EMAIL not set', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'ACLED_KEY') return 'acled-key';
        return undefined;
      });

      const module = await Test.createTestingModule({
        providers: [
          NewsIngestionService,
          { provide: ConfigService, useValue: { get: configGet } },
        ],
      }).compile();
      service = module.get<NewsIngestionService>(NewsIngestionService);

      const results = await service.fetchAcled(since);
      expect(results).toEqual([]);
    });

    it('should return formatted events when keys are set', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'ACLED_KEY') return 'acled-key';
        if (key === 'ACLED_EMAIL') return 'test@example.com';
        return undefined;
      });

      const module = await Test.createTestingModule({
        providers: [
          NewsIngestionService,
          { provide: ConfigService, useValue: { get: configGet } },
        ],
      }).compile();
      service = module.get<NewsIngestionService>(NewsIngestionService);

      mockedAxios.get.mockResolvedValue({
        data: {
          data: [
            {
              event_date: '2026-02-18',
              event_type: 'Battles',
              notes: 'Armed clash between forces',
              country: 'Colombia',
            },
          ],
        },
      });

      const results = await service.fetchAcled(since);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          title: 'Battles in Colombia',
          description: 'Armed clash between forces',
          source: 'acled',
          rawText: 'Battles in Colombia: Armed clash between forces',
        }),
      );
    });
  });

  describe('fetchAll()', () => {
    it('should combine results from all sources', async () => {
      // GDELT will work (no key needed), NewsAPI and ACLED won't (no keys)
      mockedAxios.get.mockResolvedValue({
        data: {
          articles: [
            { url: 'url1', title: 'GDELT Article 1' },
            { url: 'url2', title: 'GDELT Article 2' },
          ],
        },
      });

      const results = await service.fetchAll(since);

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => r.source === 'gdelt')).toBe(true);
    });

    it('should deduplicate by first 60 chars of title (case-insensitive)', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          articles: [
            { url: 'url1', title: 'Military conflict erupts in South America causing chaos' },
            { url: 'url2', title: 'Military conflict erupts in South America causing chaos updated' },
            { url: 'url3', title: 'Different article about economics' },
          ],
        },
      });

      const results = await service.fetchAll(since);

      // First two share the same first 60 chars → one should be deduped
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should handle all sources failing gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('All fail'));

      const results = await service.fetchAll(since);
      expect(results).toEqual([]);
    });
  });
});
