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
  COUNTRY_COORDS,
  haversineDistance,
} from '../common/utils/shock-calc.js';
import { EventsService } from '../events/events.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';

@Injectable()
export class GlobeService {
  private readonly logger = new Logger(GlobeService.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly vectorDbService: VectorDbService,
    private readonly nlpService: SphinxNlpService,
  ) {}

  /** Cache: eventId → computed heatmap */
  private readonly heatmapCache = new Map<string, HeatmapEntry[]>();
  /** Cache: eventId → computed arcs */
  private readonly arcsCache = new Map<string, ConnectionArc[]>();

  /** Clear all cached heatmaps and arcs (call after new events are ingested). */
  clearCaches(): void {
    this.heatmapCache.clear();
    this.arcsCache.clear();
  }

  getHeatmap(eventId?: string): HeatmapEntry[] {
    if (eventId) {
      return this.getHeatmapForEvent(eventId);
    }
    return this.getMergedHeatmap();
  }

  getArcs(eventId?: string): ConnectionArc[] {
    if (eventId) {
      return this.getArcsForEvent(eventId);
    }
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

  /**
   * Vector-DB augmented proximity: embeds the event text, queries for similar
   * historical events, returns their affected countries as proxy-proximity dots.
   * Falls back to empty array if vector DB or NLP is unavailable.
   */
  async getVectorProximity(eventId: string): Promise<HeatmapEntry[]> {
    const event = this.eventsService.getAll().find((e: ShockEvent) => e.id === eventId);
    if (!event) return [];

    if (!this.vectorDbService.enabled) {
      return [];
    }

    try {
      const text = `${event.title} ${event.description} ${event.type} ${event.location.country}`;
      const embedding = await this.nlpService.embed(text);
      const similar = await this.vectorDbService.querySimilarEvents(embedding, 10);

      const byCountry = new Map<string, HeatmapEntry>();

      for (const result of similar) {
        if (result.eventId === eventId) continue;
        const similarEvent = this.eventsService
          .getAll()
          .find((e: ShockEvent) => e.id === result.eventId);
        if (!similarEvent) continue;

        for (const countryName of similarEvent.affectedCountries) {
          const coords = COUNTRY_COORDS[countryName];
          if (!coords) continue;

          const intensity = parseFloat((result.similarity * 0.45).toFixed(3));
          const existing = byCountry.get(countryName);
          if (!existing || intensity > existing.shockIntensity) {
            byCountry.set(countryName, {
              country: countryName,
              countryCode: countryName,
              lat: coords.lat,
              lng: coords.lng,
              shockIntensity: intensity,
              affectedSectors: EVENT_SECTOR_MAP[similarEvent.type] ?? [],
              topAffectedStocks: [],
              direction: 'mixed',
            });
          }
        }
      }

      return [...byCountry.values()];
    } catch (err) {
      this.logger.warn(`Vector proximity failed for ${eventId}: ${(err as Error).message}`);
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  private getHeatmapForEvent(eventId: string): HeatmapEntry[] {
    const cached = this.heatmapCache.get(eventId);
    if (cached) return cached;

    const event = this.eventsService.getAll().find((e: ShockEvent) => e.id === eventId);
    if (!event) return [];

    try {
      const heatmap = this.buildCountryProximityHeatmap(event);
      this.heatmapCache.set(eventId, heatmap);
      return heatmap;
    } catch (err) {
      this.logger.warn(`Failed to compute heatmap for ${eventId}, falling back to seed`, err);
      return SEED_HEATMAP.filter((entry: HeatmapEntry) =>
        event.affectedCountries.includes(entry.country) ||
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
      const heatmap = this.buildCountryProximityHeatmap(event);
      const arcs = this.buildArcsFromHeatmap(event.location, heatmap, eventId);
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
   * Build country-level heatmap entries from the event's affectedCountries list.
   * Intensity is computed from geographic proximity to the epicenter × severity.
   * The epicenter country itself gets the full severity/10 as intensity.
   */
  private buildCountryProximityHeatmap(event: ShockEvent): HeatmapEntry[] {
    const affectedSectors = EVENT_SECTOR_MAP[event.type] ?? [];
    const entries: HeatmapEntry[] = [];

    for (const countryName of event.affectedCountries) {
      const coords = COUNTRY_COORDS[countryName];
      if (!coords) {
        this.logger.verbose(`No coords for country: ${countryName}`);
        continue;
      }

      const isEpicenter = countryName === event.location.country;
      let shockIntensity: number;

      if (isEpicenter) {
        shockIntensity = Math.min(event.severity / 10, 1);
      } else {
        const distance = haversineDistance(
          event.location.lat,
          event.location.lng,
          coords.lat,
          coords.lng,
        );
        const maxEarth = 20_037;
        const geoProximity = 1 - Math.min(distance / maxEarth, 1);
        shockIntensity = parseFloat((geoProximity * (event.severity / 10)).toFixed(3));
      }

      // Stocks in this country that are in the event's affectedTickers
      const countryStocks = event.affectedTickers?.length
        ? SEED_STOCKS.filter(
            (s) => s.country === countryName && event.affectedTickers.includes(s.ticker),
          )
        : [];

      entries.push({
        country: countryName,
        countryCode: countryName,
        lat: coords.lat,
        lng: coords.lng,
        shockIntensity,
        affectedSectors,
        topAffectedStocks: countryStocks.slice(0, 3).map((s) => s.ticker),
        direction: isEpicenter ? 'negative' : this.inferDirection(event.type),
      });
    }

    return entries;
  }

  /**
   * Build arcs from the event epicenter to each significantly affected country.
   */
  private buildArcsFromHeatmap(
    epicenter: { lat: number; lng: number; country: string },
    heatmap: HeatmapEntry[],
    eventId: string,
  ): ConnectionArc[] {
    return heatmap
      .filter((entry) => entry.country !== epicenter.country && entry.shockIntensity >= 0.2)
      .map((entry) => ({
        id: `${eventId}-arc-${entry.country}`,
        startLat: epicenter.lat,
        startLng: epicenter.lng,
        endLat: entry.lat,
        endLng: entry.lng,
        fromLabel: epicenter.country,
        toLabel: entry.country,
        shockIntensity: entry.shockIntensity,
        direction: entry.direction === 'positive' ? ('positive' as const) : ('negative' as const),
        color: entry.direction === 'positive' ? '#22c55e' : '#ef4444',
        eventId,
        sector: entry.affectedSectors[0],
      }));
  }

  private inferDirection(eventType: string): 'positive' | 'negative' | 'mixed' {
    if (eventType === 'military' || eventType === 'natural_disaster') return 'mixed';
    if (eventType === 'geopolitical') return 'mixed';
    return 'negative';
  }
}
