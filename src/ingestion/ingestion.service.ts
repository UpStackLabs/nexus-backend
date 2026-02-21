import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NewsIngestionService, RawNewsItem } from './news-ingestion.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import { EventsService } from '../events/events.service.js';
import { GlobeService } from '../globe/globe.service.js';
import { COUNTRY_COORDS, EVENT_SECTOR_MAP, calculateStockShock } from '../common/utils/shock-calc.js';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type { ShockEvent } from '../common/types/index.js';

export interface IngestionSummary {
  itemsFetched: number;
  itemsProcessed: number;
  itemsFailed: number;
  newEvents: ShockEvent[];
  durationMs: number;
}

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);
  private lastRun: Date = new Date(Date.now() - 5 * 60 * 1000);

  constructor(
    private readonly newsIngestion: NewsIngestionService,
    private readonly nlp: SphinxNlpService,
    private readonly vectorDb: VectorDbService,
    private readonly gateway: ShockGlobeGateway,
    private readonly eventsService: EventsService,
    private readonly globeService: GlobeService,
  ) {}

  onModuleInit() {
    this.runManualIngestion().catch((err) =>
      this.logger.warn(`Initial ingestion failed: ${(err as Error).message}`),
    );
  }

  @Cron('0 */5 * * * *')
  async runScheduledIngestion(): Promise<void> {
    const summary = await this.runManualIngestion();
    this.logger.log(
      `[IngestionService] Cron run completed: ${summary.itemsProcessed} processed, ${summary.newEvents.length} new events`,
    );
  }

  /** Called by the frontend with pre-fetched GDELT articles */
  async processArticles(articles: { title: string; text: string; source: string; publishedAt?: string }[]): Promise<IngestionSummary> {
    const start = Date.now();
    const rawItems: RawNewsItem[] = articles.map((a) => ({
      title: a.title,
      description: '',
      rawText: a.text,
      source: a.source,
      publishedAt: a.publishedAt ?? new Date().toISOString(),
    }));
    return this.classifyAndStore(rawItems, start);
  }

  async runManualIngestion(): Promise<IngestionSummary> {
    const start = Date.now();
    const since = this.lastRun;
    this.lastRun = new Date();
    const rawItems = (await this.newsIngestion.getCachedRaw()).slice(0, 30);
    this.logger.log(`[IngestionService] Fetched ${rawItems.length} raw items from news sources`);
    return this.classifyAndStore(rawItems, start);
  }

  /**
   * Resolve lat/lng from classified location string and affectedCountries ISO codes.
   * Tries: affectedCountries ISO codes → location string parts → fallback (0, 0).
   */
  private geocode(
    location: string,
    affectedCountries: string[],
  ): { lat: number; lng: number } {
    // Try ISO codes from affectedCountries first
    for (const code of affectedCountries) {
      const coords = COUNTRY_COORDS[code.toUpperCase()];
      if (coords) return coords;
    }

    // Try matching parts of the location string (e.g. "Beijing, China")
    const parts = location.split(/[,;]+/).map((s) => s.trim());
    for (const part of parts.reverse()) {
      const coords = COUNTRY_COORDS[part];
      if (coords) return coords;
    }

    return { lat: 0, lng: 0 };
  }

  private async classifyAndStore(rawItems: RawNewsItem[], start: number): Promise<IngestionSummary> {
    let itemsProcessed = 0;
    let itemsFailed = 0;
    const newEvents: ShockEvent[] = [];

    const results = await Promise.allSettled(
      rawItems.map(async (item) => {
        const classified = await this.nlp.classifyEvent(item.rawText);
        const embedding = await this.nlp.embed(item.rawText);
        const idSnippet = `${Date.now().toString(16).slice(-4)}${Math.random().toString(16).slice(2, 6)}`;
        const eventId = `evt-${idSnippet}`;

        const coords = this.geocode(classified.location, classified.affectedCountries);
        const event: ShockEvent = {
          id: eventId,
          title: item.title,
          description: item.description,
          type: classified.type as ShockEvent['type'],
          severity: Math.min(10, Math.max(1, classified.severity)),
          location: { ...coords, country: classified.location },
          timestamp: item.publishedAt,
          affectedCountries: classified.affectedCountries,
          affectedSectors: classified.affectedSectors,
          affectedTickers: classified.affectedTickers,
          source: item.source,
          isSimulated: false,
        };

        this.eventsService.addEvent(event);
        this.gateway.emitNewEvent(event);

        // Compute and broadcast shock scores for this event
        const affectedSectors = EVENT_SECTOR_MAP[event.type] ?? [];
        const stocks = event.affectedTickers?.length
          ? SEED_STOCKS.filter((s) => event.affectedTickers.includes(s.ticker))
          : SEED_STOCKS.slice(0, 10);
        for (const stock of stocks) {
          const shock = calculateStockShock(stock, event.location, eventId, affectedSectors, event.severity);
          this.gateway.emitShockUpdate(shock);
        }

        this.vectorDb.upsertEventVector(eventId, item.rawText, embedding, {
          title: item.title,
          type: event.type,
          severity: event.severity,
          location: event.location,
          timestamp: event.timestamp,
        }).catch((err: Error) =>
          this.logger.warn(`VectorDB upsert skipped for ${eventId}: ${err.message}`),
        );

        return event;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        newEvents.push(result.value);
        itemsProcessed++;
      } else {
        this.logger.warn(`Failed to process item: ${(result.reason as Error).message}`);
        itemsFailed++;
      }
    }

    // Invalidate globe caches so new events show on the map
    if (newEvents.length > 0) {
      this.globeService.clearCaches();
    }

    return {
      itemsFetched: rawItems.length,
      itemsProcessed,
      itemsFailed,
      newEvents,
      durationMs: Date.now() - start,
    };
  }
}
