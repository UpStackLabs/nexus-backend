import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SEED_EVENTS, SEED_SHOCKS } from '../common/data/seed-data.js';
import type { ShockEvent, ShockScore } from '../common/types/index.js';
import { QueryEventsDto } from './dto/query-events.dto.js';

export interface PaginatedEvents {
  data: ShockEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly events: ShockEvent[] = [...SEED_EVENTS];
  private readonly shocks: ShockScore[] = SEED_SHOCKS;
  private hasPurgedSeed = false;

  /** Returns the current events list (for use by other services). */
  getAll(): ShockEvent[] {
    return this.events;
  }

  addEvent(event: ShockEvent): void {
    // Once real (non-simulated) data arrives, purge seed events
    if (!event.isSimulated && !this.hasPurgedSeed) {
      const seedCount = this.events.filter((e) => e.isSimulated).length;
      if (seedCount > 0) {
        // Remove all seed events
        for (let i = this.events.length - 1; i >= 0; i--) {
          if (this.events[i].isSimulated) this.events.splice(i, 1);
        }
        this.logger.log(`Purged ${seedCount} seed events — real data now available`);
      }
      this.hasPurgedSeed = true;
    }

    const titleLower = event.title.toLowerCase().slice(0, 80);
    const duplicate = this.events.some(
      (e) => e.title.toLowerCase().slice(0, 80) === titleLower,
    );
    if (!duplicate) this.events.unshift(event);
  }

  findAll(query: QueryEventsDto): PaginatedEvents {
    let filtered = [...this.events];

    if (query.type) {
      filtered = filtered.filter((event) => event.type === query.type);
    }

    if (query.minSeverity !== undefined) {
      filtered = filtered.filter(
        (event) => event.severity >= query.minSeverity!,
      );
    }

    if (query.maxSeverity !== undefined) {
      filtered = filtered.filter(
        (event) => event.severity <= query.maxSeverity!,
      );
    }

    if (query.startDate) {
      const start = new Date(query.startDate).getTime();
      filtered = filtered.filter(
        (event) => new Date(event.timestamp).getTime() >= start,
      );
    }

    if (query.endDate) {
      const end = new Date(query.endDate).getTime();
      filtered = filtered.filter(
        (event) => new Date(event.timestamp).getTime() <= end,
      );
    }

    if (query.country) {
      const country = query.country.toLowerCase();
      filtered = filtered.filter(
        (event) =>
          event.location.country.toLowerCase() === country ||
          event.affectedCountries.some((c) => c.toLowerCase() === country),
      );
    }

    const total = filtered.length;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return { data, total, page, limit, totalPages };
  }

  findOne(id: string): ShockEvent {
    const event = this.events.find((e) => e.id === id);

    if (!event) {
      throw new NotFoundException(`Event with ID "${id}" not found`);
    }

    return event;
  }

  getShocks(id: string): ShockScore[] {
    const event = this.events.find((e) => e.id === id);

    if (!event) {
      throw new NotFoundException(`Event with ID "${id}" not found`);
    }

    return this.shocks.filter((shock) =>
      event.affectedTickers.includes(shock.ticker),
    );
  }
}
