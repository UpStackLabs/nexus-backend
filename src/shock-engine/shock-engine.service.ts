import { Injectable } from '@nestjs/common';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { SEED_EVENTS, SEED_SHOCKS } from '../common/data/seed-data.js';
import type {
  StockAnalysis,
  RelevantEvent,
  ShockAnalysisResult,
} from '../common/types/index.js';
import type { Stock } from '../common/types/index.js';

const EVENT_SECTOR_MAP: Record<string, string[]> = {
  military: ['Defense', 'Energy', 'Industrials', 'Materials'],
  economic: ['Finance', 'Technology', 'Industrials'],
  policy: ['Healthcare', 'Finance', 'Technology', 'Energy'],
  natural_disaster: ['Materials', 'Energy', 'Industrials', 'Healthcare'],
  geopolitical: ['Energy', 'Finance', 'Defense', 'Technology', 'Materials'],
};

@Injectable()
export class ShockEngineService {
  constructor(
    private readonly vectorDb: VectorDbService,
    private readonly nlp: SphinxNlpService,
  ) {}

  async computeAnalysis(
    stock: Stock,
    _currentPrice: number,
  ): Promise<{ relevantEvents: RelevantEvent[]; shockAnalysis: ShockAnalysisResult }> {
    const queryText = `${stock.companyName} ${stock.sector} ${stock.country} stock market impact`;
    let vectorResults: Awaited<ReturnType<typeof this.vectorDb.querySimilarEvents>> = [];
    if (this.vectorDb.enabled) {
      const embedding = await this.nlp.embed(queryText);
      vectorResults = await this.vectorDb.querySimilarEvents(embedding, 10);
    }

    const relevantEvents: RelevantEvent[] = vectorResults.map((result) => {
      const seedEvent = SEED_EVENTS.find((e) => e.id === result.eventId);
      const meta = result.metadata as Record<string, unknown>;
      return {
        eventId: result.eventId,
        title: seedEvent?.title ?? (meta.title as string) ?? result.eventId,
        type: seedEvent?.type ?? (meta.type as string) ?? 'geopolitical',
        severity: seedEvent?.severity ?? (meta.severity as number) ?? 5,
        location: seedEvent?.location ?? (meta.location as { lat: number; lng: number; country: string }) ?? {
          lat: 0,
          lng: 0,
          country: 'Unknown',
        },
        timestamp: seedEvent?.timestamp ?? (meta.timestamp as string) ?? new Date().toISOString(),
        vectorSimilarity: result.similarity,
        description: seedEvent?.description ?? '',
      };
    });

    // Fallback to seed events when vector DB has no results
    if (relevantEvents.length === 0) {
      SEED_EVENTS.slice(0, 3).forEach((e) => {
        relevantEvents.push({
          eventId: e.id,
          title: e.title,
          type: e.type,
          severity: e.severity,
          location: e.location,
          timestamp: e.timestamp,
          vectorSimilarity: parseFloat((Math.random() * 0.3 + 0.5).toFixed(3)),
          description: e.description ?? '',
        });
      });
    }

    // Compute S(c,e) for top-3 events
    const top3 = relevantEvents.slice(0, 3);
    const componentsList = top3.map((event) => {
      const sim = event.vectorSimilarity;

      // H: historical sensitivity from SEED_SHOCKS
      const shocks = SEED_SHOCKS.filter(
        (s) => s.ticker === stock.ticker && s.eventId === event.eventId,
      );
      const H =
        shocks.length > 0
          ? shocks.reduce((sum, s) => sum + s.historicalSensitivity, 0) / shocks.length
          : 0.5;

      // G: geographic proximity via Haversine
      const distance = this.haversineDistance(
        event.location.lat,
        event.location.lng,
        stock.location.lat,
        stock.location.lng,
      );
      const G = parseFloat((1 - Math.min(distance / 20037, 1)).toFixed(3));

      // SC: supply chain linkage via sector match
      const affectedSectors = EVENT_SECTOR_MAP[event.type] ?? [];
      const sectorIndex = affectedSectors.indexOf(stock.sector);
      const SC = sectorIndex >= 0 ? 1 - sectorIndex / (affectedSectors.length + 1) : 0.1;

      const score = 0.35 * sim + 0.25 * H + 0.2 * G + 0.2 * SC;

      return { sim, H, G, SC, score, severity: event.severity };
    });

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const compositeShockScore = parseFloat(avg(componentsList.map((c) => c.score)).toFixed(3));
    const avgSim = parseFloat(avg(componentsList.map((c) => c.sim)).toFixed(3));
    const avgH = parseFloat(avg(componentsList.map((c) => c.H)).toFixed(3));
    const avgG = parseFloat(avg(componentsList.map((c) => c.G)).toFixed(3));
    const avgSC = parseFloat(avg(componentsList.map((c) => c.SC)).toFixed(3));
    const avgSeverity = avg(componentsList.map((c) => c.severity));

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (compositeShockScore < 0.25) riskLevel = 'low';
    else if (compositeShockScore < 0.5) riskLevel = 'medium';
    else if (compositeShockScore < 0.75) riskLevel = 'high';
    else riskLevel = 'critical';

    const primaryEvent = top3[0];
    const primarySectors = EVENT_SECTOR_MAP[primaryEvent?.type ?? 'geopolitical'] ?? [];
    const sectorIdx = primarySectors.indexOf(stock.sector);
    const direction: 'up' | 'down' = sectorIdx >= 0 && sectorIdx < 2 ? 'up' : 'down';
    const directionSign = direction === 'up' ? 1 : -1;
    const predictedPriceChange = parseFloat(
      (compositeShockScore * (avgSeverity / 10) * directionSign * 2).toFixed(2),
    );
    const confidence = parseFloat(Math.min(0.5 + compositeShockScore * 0.5, 0.95).toFixed(2));

    const allShocks = SEED_SHOCKS.filter((s) => s.ticker === stock.ticker);
    const surpriseFactor =
      allShocks.length > 0
        ? parseFloat(
            (
              allShocks.reduce((sum, s) => sum + (s.surpriseFactor ?? 0), 0) / allShocks.length
            ).toFixed(2),
          )
        : 0;

    return {
      relevantEvents,
      shockAnalysis: {
        compositeShockScore,
        predictedPriceChange,
        confidence,
        direction,
        components: {
          similarityScore: avgSim,
          historicalSensitivity: avgH,
          geographicProximity: avgG,
          supplyChainLinkage: avgSC,
        },
        surpriseFactor,
        riskLevel,
      },
    };
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = this.degToRad(lat2 - lat1);
    const dLng = this.degToRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.degToRad(lat1)) * Math.cos(this.degToRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private degToRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
