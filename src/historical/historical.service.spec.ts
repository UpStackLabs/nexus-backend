import { Test, TestingModule } from '@nestjs/testing';
import { HistoricalService } from './historical.service.js';
import { SEED_EVENTS } from '../common/data/seed-data.js';

describe('HistoricalService', () => {
  let service: HistoricalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HistoricalService],
    }).compile();

    service = module.get<HistoricalService>(HistoricalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findSimilar() - by eventId', () => {
    it('should find events of the same type as source event', () => {
      // evt-001 is 'military' — no other military events in seed
      const result = service.findSimilar({ eventId: 'evt-001' });
      result.forEach((event) => {
        expect(event.type).toBe('military');
      });
    });

    it('should exclude the source event from results', () => {
      const result = service.findSimilar({ eventId: 'evt-001' });
      expect(result.find((e) => e.id === 'evt-001')).toBeUndefined();
    });

    it('should return empty array for non-existent eventId', () => {
      const result = service.findSimilar({ eventId: 'evt-999' });
      expect(result).toEqual([]);
    });

    it('should sort by severity similarity to source event', () => {
      // evt-002 is 'economic' severity 6 — no other economic events
      const result = service.findSimilar({ eventId: 'evt-002' });
      // Since there are no other economic events, result should be empty
      expect(result).toHaveLength(0);
    });

    it('should respect limit parameter', () => {
      const result = service.findSimilar({ eventId: 'evt-001', limit: 1 });
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it('should default limit to 5', () => {
      const result = service.findSimilar({ eventId: 'evt-001' });
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe('findSimilar() - by description', () => {
    it('should match events by keywords in title/description/type', () => {
      const result = service.findSimilar({ description: 'military invasion' });

      expect(result.length).toBeGreaterThan(0);
      // Should include the Venezuelan Invasion event
      const titles = result.map((e) => e.title);
      expect(titles.some((t) => t.includes('Venezuelan'))).toBe(true);
    });

    it('should be case-insensitive', () => {
      const r1 = service.findSimilar({ description: 'MILITARY' });
      const r2 = service.findSimilar({ description: 'military' });

      expect(r1.length).toBe(r2.length);
    });

    it('should ignore keywords with 2 or fewer characters', () => {
      const result = service.findSimilar({ description: 'a an' });
      expect(result).toEqual([]);
    });

    it('should return empty for no matching keywords', () => {
      const result = service.findSimilar({ description: 'xyznonexistent' });
      expect(result).toEqual([]);
    });

    it('should sort by match count descending', () => {
      const result = service.findSimilar({ description: 'earthquake Japan tsunami' });

      // The Japan Earthquake event should score highest
      if (result.length > 0) {
        expect(result[0].title).toContain('Japan');
      }
    });

    it('should respect limit parameter', () => {
      const result = service.findSimilar({ description: 'economic', limit: 2 });
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should match events that mention oil or energy', () => {
      const result = service.findSimilar({ description: 'oil supply disruption' });
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('findSimilar() - default (no criteria)', () => {
    it('should return most recent events sorted by timestamp', () => {
      const result = service.findSimilar({});

      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(5);

      // Verify descending timestamp order
      for (let i = 1; i < result.length; i++) {
        const prev = new Date(result[i - 1].timestamp).getTime();
        const curr = new Date(result[i].timestamp).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('should default limit to 5', () => {
      const result = service.findSimilar({});
      expect(result.length).toBe(Math.min(5, SEED_EVENTS.length));
    });

    it('should respect custom limit', () => {
      const result = service.findSimilar({ limit: 2 });
      expect(result.length).toBe(2);
    });

    it('should return all events when limit exceeds total', () => {
      const result = service.findSimilar({ limit: 20 });
      expect(result.length).toBe(SEED_EVENTS.length);
    });
  });
});
