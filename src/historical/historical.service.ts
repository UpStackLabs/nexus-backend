import { Injectable } from '@nestjs/common';
import { SEED_EVENTS } from '../common/data/seed-data.js';
import type { ShockEvent } from '../common/types/index.js';
import type { SimilarQueryDto } from './dto/similar-query.dto.js';

@Injectable()
export class HistoricalService {
  findSimilar(query: SimilarQueryDto): ShockEvent[] {
    const limit = query.limit ?? 5;

    // If eventId is provided, find events of the same type ranked by severity similarity
    if (query.eventId) {
      const sourceEvent = SEED_EVENTS.find(
        (e: ShockEvent) => e.id === query.eventId,
      );

      if (!sourceEvent) {
        return [];
      }

      return SEED_EVENTS.filter((e: ShockEvent) => e.id !== sourceEvent.id)
        .filter((e: ShockEvent) => e.type === sourceEvent.type)
        .sort(
          (a: ShockEvent, b: ShockEvent) =>
            Math.abs(a.severity - sourceEvent.severity) -
            Math.abs(b.severity - sourceEvent.severity),
        )
        .slice(0, limit);
    }

    // If description is provided, do a simple keyword match
    if (query.description) {
      const keywords = query.description
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (keywords.length === 0) {
        return [];
      }

      const scored = SEED_EVENTS.map((event: ShockEvent) => {
        const text =
          `${event.title} ${event.description} ${event.type}`.toLowerCase();
        const matchCount = keywords.filter((kw) => text.includes(kw)).length;
        return { event, matchCount };
      })
        .filter((item) => item.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount);

      return scored.slice(0, limit).map((item) => item.event);
    }

    // If neither provided, return the most recent events
    return [...SEED_EVENTS]
      .sort(
        (a: ShockEvent, b: ShockEvent) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, limit);
  }
}
