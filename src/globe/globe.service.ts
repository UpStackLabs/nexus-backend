import { Injectable, Logger } from '@nestjs/common';
import {
  SEED_STOCKS,
  SEED_HEATMAP,
  SEED_ARCS,
} from '../common/data/seed-data.js';
import type {
  HeatmapEntry,
  ConnectionArc,
  EventMarker,
  ShockEvent,
} from '../common/types/index.js';
import {
  EVENT_SECTOR_MAP,
  calculateStockShock,
  buildHeatmapFromShocks,
  buildArcsFromShocks,
} from '../common/utils/shock-calc.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class GlobeService {
  private readonly logger = new Logger(GlobeService.name);

  constructor(private readonly eventsService: EventsService) {}

  /** Cache: eventId → computed heatmap */
  private readonly heatmapCache = new Map<string, HeatmapEntry[]>();
  /** Cache: eventId → computed arcs */
  private readonly arcsCache = new Map<string, ConnectionArc[]>();

  getHeatmap(eventId?: string): HeatmapEntry[] {
    if (eventId) {
      return this.getHeatmapForEvent(eventId);
    }
    // No eventId: merge heatmaps from all events, keep highest intensity per country
    return this.getMergedHeatmap();
  }

  getArcs(eventId?: string): ConnectionArc[] {
    if (eventId) {
      return this.getArcsForEvent(eventId);
    }
    // No eventId: combine arcs from all events
    return this.getAllArcs();
  }

  getEventMarkers(): EventMarker[] {
    return this.eventsService.getAll().map((event: ShockEvent) => ({
      id: event.id,
      lat: event.location.lat,
      lng: event.location.lng,
      title: event.title,
      type: event.type,
      severity: event.severity,
      isEpicenter: true,
      rippleRadius: event.severity * 10,
    }));
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  private getHeatmapForEvent(eventId: string): HeatmapEntry[] {
    // Check cache first
    const cached = this.heatmapCache.get(eventId);
    if (cached) return cached;

    const event = this.eventsService.getAll().find((e: ShockEvent) => e.id === eventId);
    if (!event) return [];

    try {
      const shocks = this.computeShocksForEvent(event);
      const heatmap = buildHeatmapFromShocks(shocks);
      this.heatmapCache.set(eventId, heatmap);
      return heatmap;
    } catch (err) {
      this.logger.warn(`Failed to compute heatmap for ${eventId}, falling back to seed`, err);
      return SEED_HEATMAP.filter((entry: HeatmapEntry) =>
        event.affectedCountries.includes(entry.countryCode),
      );
    }
  }

  private getArcsForEvent(eventId: string): ConnectionArc[] {
    const cached = this.arcsCache.get(eventId);
    if (cached) return cached;

    const event = this.eventsService.getAll().find((e: ShockEvent) => e.id === eventId);
    if (!event) return [];

    try {
      const shocks = this.computeShocksForEvent(event);
      const arcs = buildArcsFromShocks(event.location, shocks, eventId);
      this.arcsCache.set(eventId, arcs);
      return arcs;
    } catch (err) {
      this.logger.warn(`Failed to compute arcs for ${eventId}, falling back to seed`, err);
      return SEED_ARCS.filter((arc: ConnectionArc) => arc.eventId === eventId);
    }
  }

  private getMergedHeatmap(): HeatmapEntry[] {
    const byCountry = new Map<string, HeatmapEntry>();

    for (const event of this.eventsService.getAll()) {
      const heatmap = this.getHeatmapForEvent(event.id);
      for (const entry of heatmap) {
        const existing = byCountry.get(entry.country);
        if (!existing || entry.shockIntensity > existing.shockIntensity) {
          byCountry.set(entry.country, entry);
        }
      }
    }

    return [...byCountry.values()];
  }

  private getAllArcs(): ConnectionArc[] {
    const allArcs: ConnectionArc[] = [];
    for (const event of this.eventsService.getAll()) {
      allArcs.push(...this.getArcsForEvent(event.id));
    }
    return allArcs;
  }

  /**
   * Compute shock scores for all stocks affected by an event.
   */
  private computeShocksForEvent(event: ShockEvent) {
    const affectedSectors = EVENT_SECTOR_MAP[event.type] ?? [];

    // Filter to only stocks in the event's affectedTickers list
    const stocks = event.affectedTickers?.length
      ? SEED_STOCKS.filter((s) => event.affectedTickers.includes(s.ticker))
      : SEED_STOCKS;

    const shocks = stocks.map((stock) =>
      calculateStockShock(
        stock,
        event.location,
        event.id,
        affectedSectors,
        event.severity,
      ),
    );

    // Sort descending by absolute score
    shocks.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    return shocks;
  }
}
