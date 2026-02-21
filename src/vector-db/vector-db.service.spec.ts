import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VectorDbService } from './vector-db.service.js';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('VectorDbService', () => {
  // ─── No bridge URL configured ─────────────────────────────────
  describe('when ACTIAN_BRIDGE_URL is not set', () => {
    let service: VectorDbService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VectorDbService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<VectorDbService>(VectorDbService);
      await service.onModuleInit();
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should report not enabled', () => {
      expect(service.enabled).toBe(false);
    });

    it('should return empty array for querySimilarEvents', async () => {
      const results = await service.querySimilarEvents([0.1, 0.2, 0.3]);
      expect(results).toEqual([]);
    });

    it('should silently resolve for upsertEventVector', async () => {
      await expect(
        service.upsertEventVector('evt-1', 'test', [0.1], { title: 'test' }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── Bridge URL configured but unreachable ────────────────────
  describe('when bridge is configured but unreachable', () => {
    let service: VectorDbService;

    beforeEach(async () => {
      mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VectorDbService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'ACTIAN_BRIDGE_URL') return 'http://localhost:8001';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<VectorDbService>(VectorDbService);
      await service.onModuleInit();
    });

    afterEach(() => jest.clearAllMocks());

    it('should report not enabled after failed health check', () => {
      expect(service.enabled).toBe(false);
    });

    it('should return empty array for querySimilarEvents when unreachable', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
      const results = await service.querySimilarEvents([0.1, 0.2, 0.3]);
      expect(results).toEqual([]);
    });

    it('should not throw for upsertEventVector when unreachable', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        service.upsertEventVector('evt-1', 'test', [0.1], { title: 'test' }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── Bridge URL configured and reachable ──────────────────────
  describe('when bridge is configured and reachable', () => {
    let service: VectorDbService;

    beforeEach(async () => {
      mockedAxios.get.mockResolvedValue({ data: { status: 'ok' } });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VectorDbService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'ACTIAN_BRIDGE_URL') return 'http://localhost:8001';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<VectorDbService>(VectorDbService);
      await service.onModuleInit();
    });

    afterEach(() => jest.clearAllMocks());

    it('should report enabled after successful health check', () => {
      expect(service.enabled).toBe(true);
    });

    describe('querySimilarEvents()', () => {
      it('should return mapped results from bridge', async () => {
        mockedAxios.post.mockResolvedValue({
          data: [
            {
              event_id: 'evt-001',
              similarity: 0.92,
              metadata: { title: 'Venezuelan Invasion', type: 'military' },
            },
            {
              event_id: 'evt-002',
              similarity: 0.78,
              metadata: { title: 'US Jobs Report', type: 'economic' },
            },
          ],
        });

        const results = await service.querySimilarEvents(
          new Array(384).fill(0.1),
          10,
        );

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          eventId: 'evt-001',
          similarity: 0.92,
          metadata: { title: 'Venezuelan Invasion', type: 'military' },
        });
        expect(results[1].eventId).toBe('evt-002');
      });

      it('should pass correct payload to bridge', async () => {
        mockedAxios.post.mockResolvedValue({ data: [] });
        const embedding = [0.1, 0.2, 0.3];

        await service.querySimilarEvents(embedding, 5);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          'http://localhost:8001/search',
          { embedding, top_k: 5 },
          { timeout: 10_000 },
        );
      });

      it('should default topK to 10', async () => {
        mockedAxios.post.mockResolvedValue({ data: [] });

        await service.querySimilarEvents([0.1]);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ top_k: 10 }),
          expect.any(Object),
        );
      });

      it('should return empty array on bridge error', async () => {
        mockedAxios.post.mockRejectedValue(new Error('Internal Server Error'));

        const results = await service.querySimilarEvents([0.1]);
        expect(results).toEqual([]);
      });
    });

    describe('upsertEventVector()', () => {
      it('should send correct payload to bridge', async () => {
        mockedAxios.post.mockResolvedValue({ data: { ok: true } });
        const embedding = [0.1, 0.2, 0.3];
        const metadata = { title: 'Test Event', severity: 5 };

        await service.upsertEventVector('evt-test', 'raw text', embedding, metadata);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          'http://localhost:8001/upsert',
          { event_id: 'evt-test', embedding, metadata },
          { timeout: 10_000 },
        );
      });

      it('should not throw when upsert fails', async () => {
        mockedAxios.post.mockRejectedValue(new Error('DB error'));

        await expect(
          service.upsertEventVector('evt-1', 'text', [0.1], {}),
        ).resolves.toBeUndefined();
      });
    });
  });
});
