import { Test, TestingModule } from '@nestjs/testing';
import { IngestionService } from './ingestion.service.js';
import { NewsIngestionService } from './news-ingestion.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { NexusGateway } from '../gateway/nexus.gateway.js';
import { EventsService } from '../events/events.service.js';
import type { RawNewsItem } from './news-ingestion.service.js';

describe('IngestionService', () => {
  let service: IngestionService;
  let newsIngestion: jest.Mocked<Partial<NewsIngestionService>>;
  let nlp: jest.Mocked<Partial<SphinxNlpService>>;
  let vectorDb: jest.Mocked<Partial<VectorDbService>>;
  let gateway: jest.Mocked<Partial<NexusGateway>>;

  const mockNewsItems: RawNewsItem[] = [
    {
      title: 'Military conflict erupts in South America',
      description: 'Forces have crossed the border',
      rawText: 'Military conflict erupts in South America Forces have crossed the border',
      source: 'gdelt',
      publishedAt: '2026-02-18T06:00:00Z',
    },
    {
      title: 'Economic crisis deepens in Europe',
      description: 'GDP contracts for third quarter',
      rawText: 'Economic crisis deepens in Europe GDP contracts for third quarter',
      source: 'newsapi',
      publishedAt: '2026-02-18T08:00:00Z',
    },
  ];

  beforeEach(async () => {
    newsIngestion = {
      getCachedRaw: jest.fn().mockResolvedValue(mockNewsItems),
    };

    nlp = {
      classifyEvent: jest.fn().mockResolvedValue({
        type: 'military',
        severity: 8,
        location: 'Caracas, Venezuela',
        affectedCountries: ['VE', 'CO'],
        affectedSectors: ['Energy', 'Defense'],
        affectedTickers: ['XOM', 'LMT'],
      }),
      embed: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
    };

    vectorDb = {
      upsertEventVector: jest.fn().mockResolvedValue(undefined),
    };

    gateway = {
      emitNewEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        { provide: NewsIngestionService, useValue: newsIngestion },
        { provide: SphinxNlpService, useValue: nlp },
        { provide: VectorDbService, useValue: vectorDb },
        { provide: NexusGateway, useValue: gateway },
        { provide: EventsService, useValue: { addEvent: jest.fn() } },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runManualIngestion()', () => {
    it('should fetch news items and return ingestion summary', async () => {
      const result = await service.runManualIngestion();

      expect(result.itemsFetched).toBe(2);
      expect(result.itemsProcessed).toBe(2);
      expect(result.itemsFailed).toBe(0);
      expect(result.newEvents).toHaveLength(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should classify each news item via NLP', async () => {
      await service.runManualIngestion();

      expect(nlp.classifyEvent).toHaveBeenCalledTimes(2);
      expect(nlp.classifyEvent).toHaveBeenCalledWith(mockNewsItems[0].rawText);
      expect(nlp.classifyEvent).toHaveBeenCalledWith(mockNewsItems[1].rawText);
    });

    it('should embed each news item via NLP', async () => {
      await service.runManualIngestion();

      expect(nlp.embed).toHaveBeenCalledTimes(2);
      expect(nlp.embed).toHaveBeenCalledWith(mockNewsItems[0].rawText);
    });

    it('should upsert each event to vector DB', async () => {
      await service.runManualIngestion();

      expect(vectorDb.upsertEventVector).toHaveBeenCalledTimes(2);
      expect(vectorDb.upsertEventVector).toHaveBeenCalledWith(
        expect.stringMatching(/^evt-/),
        mockNewsItems[0].rawText,
        expect.any(Array),
        expect.objectContaining({
          title: mockNewsItems[0].title,
          type: 'military',
          severity: 8,
        }),
      );
    });

    it('should emit each new event via gateway', async () => {
      await service.runManualIngestion();

      expect(gateway.emitNewEvent).toHaveBeenCalledTimes(2);
      expect(gateway.emitNewEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^evt-/),
          title: mockNewsItems[0].title,
          type: 'military',
          severity: 8,
          isSimulated: false,
        }),
      );
    });

    it('should generate unique event IDs', async () => {
      const result = await service.runManualIngestion();

      const ids = result.newEvents.map((e) => e.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('should clamp severity to 1-10 range', async () => {
      nlp.classifyEvent!.mockResolvedValueOnce({
        type: 'military',
        severity: 15, // above max
        location: 'Test',
        affectedCountries: [],
        affectedSectors: [],
        affectedTickers: [],
      }).mockResolvedValueOnce({
        type: 'economic',
        severity: -3, // below min
        location: 'Test',
        affectedCountries: [],
        affectedSectors: [],
        affectedTickers: [],
      });

      const result = await service.runManualIngestion();

      expect(result.newEvents[0].severity).toBe(10);
      expect(result.newEvents[1].severity).toBe(1);
    });

    it('should handle NLP classification failure gracefully', async () => {
      nlp.classifyEvent!.mockRejectedValueOnce(new Error('OpenAI timeout'));

      const result = await service.runManualIngestion();

      // One should fail, one should succeed
      expect(result.itemsProcessed).toBe(1);
      expect(result.itemsFailed).toBe(1);
    });

    it('should handle empty news feed', async () => {
      newsIngestion.getCachedRaw!.mockResolvedValue([]);

      const result = await service.runManualIngestion();

      expect(result.itemsFetched).toBe(0);
      expect(result.itemsProcessed).toBe(0);
      expect(result.newEvents).toHaveLength(0);
    });

    it('should limit items to 30', async () => {
      const manyItems = Array.from({ length: 50 }, (_, i) => ({
        title: `News ${i}`,
        description: `Desc ${i}`,
        rawText: `News ${i} Desc ${i}`,
        source: 'gdelt',
        publishedAt: new Date().toISOString(),
      }));
      newsIngestion.getCachedRaw!.mockResolvedValue(manyItems);

      const result = await service.runManualIngestion();

      expect(result.itemsFetched).toBe(30);
    });

    it('should set isSimulated to false for real events', async () => {
      const result = await service.runManualIngestion();

      result.newEvents.forEach((event) => {
        expect(event.isSimulated).toBe(false);
      });
    });

    it('should set correct source from news item', async () => {
      const result = await service.runManualIngestion();

      expect(result.newEvents[0].source).toBe('gdelt');
      expect(result.newEvents[1].source).toBe('newsapi');
    });
  });

  describe('runScheduledIngestion()', () => {
    it('should call runManualIngestion', async () => {
      const spy = jest.spyOn(service, 'runManualIngestion');
      await service.runScheduledIngestion();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
