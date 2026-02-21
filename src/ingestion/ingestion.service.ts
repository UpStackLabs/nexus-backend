import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NewsIngestionService } from './news-ingestion.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import type { ShockEvent } from '../common/types/index.js';

export interface IngestionSummary {
  itemsFetched: number;
  itemsProcessed: number;
  itemsFailed: number;
  newEvents: ShockEvent[];
  durationMs: number;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private lastRun: Date = new Date(Date.now() - 5 * 60 * 1000);

  constructor(
    private readonly newsIngestion: NewsIngestionService,
    private readonly nlp: SphinxNlpService,
    private readonly vectorDb: VectorDbService,
    private readonly gateway: ShockGlobeGateway,
  ) {}

  @Cron('0 */5 * * * *')
  async runScheduledIngestion(): Promise<void> {
    const summary = await this.runManualIngestion();
    this.logger.log(
      `[IngestionService] Cron run completed: ${summary.itemsProcessed} processed, ${summary.newEvents.length} new events`,
    );
  }

  async runManualIngestion(): Promise<IngestionSummary> {
    const start = Date.now();
    const since = this.lastRun;
    this.lastRun = new Date();

    const rawItems = await this.newsIngestion.fetchAll(since);
    let itemsProcessed = 0;
    let itemsFailed = 0;
    const newEvents: ShockEvent[] = [];

    for (const item of rawItems) {
      try {
        const classified = await this.nlp.classifyEvent(item.rawText);
        const embedding = await this.nlp.embed(item.rawText);
        const idSnippet = `${Date.now().toString(16).slice(-4)}${Math.random().toString(16).slice(2, 6)}`;
        const eventId = `evt-${idSnippet}`;

        const event: ShockEvent = {
          id: eventId,
          title: item.title,
          description: item.description,
          type: classified.type as ShockEvent['type'],
          severity: Math.min(10, Math.max(1, classified.severity)),
          location: {
            lat: 0,
            lng: 0,
            country: classified.location,
          },
          timestamp: item.publishedAt,
          affectedCountries: classified.affectedCountries,
          affectedSectors: classified.affectedSectors,
          affectedTickers: classified.affectedTickers,
          source: item.source,
          isSimulated: false,
        };

        await this.vectorDb.upsertEventVector(eventId, item.rawText, embedding, {
          title: item.title,
          type: event.type,
          severity: event.severity,
          location: event.location,
          timestamp: event.timestamp,
        });

        this.gateway.emitNewEvent(event);
        newEvents.push(event);
        itemsProcessed++;
      } catch (err) {
        this.logger.warn(
          `Failed to process item "${item.title}": ${(err as Error).message}`,
        );
        itemsFailed++;
      }
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
