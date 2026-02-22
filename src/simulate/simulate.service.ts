import { Injectable, Logger } from '@nestjs/common';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type {
  SimulationResult,
  SectorImpact,
  ShockScore,
  ShockEvent,
} from '../common/types/index.js';
import { SimulateEventDto } from './dto/simulate-event.dto.js';
import {
  EVENT_SECTOR_MAP,
  calculateStockShock,
  buildHeatmapFromShocks,
  buildArcsFromShocks,
} from '../common/utils/shock-calc.js';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';

@Injectable()
export class SimulateService {
  private readonly logger = new Logger(SimulateService.name);

  constructor(
    private readonly nlp: SphinxNlpService,
    private readonly gateway: ShockGlobeGateway,
  ) {}

  /**
   * Run a what-if simulation for the given event parameters.
   *
   * The simulation:
   * 1. Generates a unique simulation event ID.
   * 2. Calculates a deterministic shock score for every stock in the seed universe.
   * 3. Enriches each shock with AI-predicted price change (blended 60/40 with deterministic).
   * 4. Builds heatmap entries and connection arcs for globe visualisation.
   * 5. Aggregates sector-level impact summaries.
   * 6. Broadcasts results via WebSocket with staggered price updates.
   */
  async runSimulation(dto: SimulateEventDto): Promise<SimulationResult> {
    const simulatedEventId = `sim-${this.generateIdSnippet()}`;
    const affectedSectors = EVENT_SECTOR_MAP[dto.type] ?? [];
    const description =
      dto.description ?? `Simulated ${dto.type} event: ${dto.title}`;

    // ── Per-stock deterministic shock calculation ────────────────────
    const shocks: ShockScore[] = SEED_STOCKS.map((stock) =>
      calculateStockShock(
        stock,
        dto.location,
        simulatedEventId,
        affectedSectors,
        dto.severity,
      ),
    );

    // ── AI enrichment: blend AI predictions with deterministic values ──
    const aiResults = await Promise.allSettled(
      shocks.map((shock) =>
        this.nlp.predictShock({
          severity: dto.severity,
          eventType: dto.type,
          sectorRelevance:
            affectedSectors.indexOf(shock.sector) >= 0
              ? 1 -
                affectedSectors.indexOf(shock.sector) /
                  (affectedSectors.length + 1)
              : 0.1,
          geographicProximity: shock.geographicProximity,
        }),
      ),
    );

    for (let i = 0; i < shocks.length; i++) {
      const result = aiResults[i];
      if (result.status === 'fulfilled') {
        const ai = result.value;
        // Blend 60% AI / 40% deterministic
        shocks[i].predictedChange = parseFloat(
          (ai.predictedChange * 0.6 + shocks[i].predictedChange * 0.4).toFixed(
            2,
          ),
        );
        shocks[i].confidence = parseFloat(
          (ai.confidence * 0.6 + shocks[i].confidence * 0.4).toFixed(2),
        );
        shocks[i].direction =
          shocks[i].predictedChange >= 0 ? 'up' : 'down';
      }
    }

    // Sort descending by absolute score so the most impacted stocks surface first.
    shocks.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    // ── Heatmap entries (one per unique country among affected stocks) ──
    const heatmap = buildHeatmapFromShocks(shocks);

    // ── Connection arcs from event epicenter to each affected country ──
    const arcs = buildArcsFromShocks(dto.location, shocks, simulatedEventId);

    // ── Sector impact aggregation ────────────────────────────────────
    const topAffectedSectors = this.buildSectorImpacts(shocks);

    // ── Interlinkedness (simplified: ratio of significantly shocked stocks) ──
    const significantlyShocked = shocks.filter(
      (s) => Math.abs(s.score) > 0.3,
    );
    const interlinkednessScore = parseFloat(
      (significantlyShocked.length / Math.max(shocks.length, 1)).toFixed(3),
    );

    const affectedCountries = new Set(
      shocks.filter((s) => s.score > 0.1).map((s) => s.country),
    );

    const result: SimulationResult = {
      simulatedEventId,
      title: dto.title,
      shocks,
      heatmap,
      arcs,
      interlinkednessScore,
      totalAffectedCompanies: significantlyShocked.length,
      totalAffectedCountries: affectedCountries.size,
      topAffectedSectors,
    };

    // ── Fire-and-forget WebSocket broadcast ──────────────────────────
    this.broadcastSimulation(dto, result, description).catch((err) =>
      this.logger.warn(`WebSocket broadcast failed: ${err.message}`),
    );

    return result;
  }

  // ──────────────────────────────────────────────────────────────────
  // WebSocket broadcast
  // ──────────────────────────────────────────────────────────────────

  private async broadcastSimulation(
    dto: SimulateEventDto,
    result: SimulationResult,
    description: string,
  ): Promise<void> {
    // T+0ms: emit the simulated event
    const simulatedEvent: ShockEvent = {
      id: result.simulatedEventId,
      title: dto.title,
      description,
      type: dto.type,
      severity: dto.severity,
      location: { ...dto.location },
      timestamp: new Date().toISOString(),
      source: 'simulation',
      affectedCountries: [
        ...new Set(result.shocks.map((s) => s.country)),
      ],
      affectedSectors: [
        ...new Set(result.shocks.map((s) => s.sector)),
      ],
      affectedTickers: result.shocks.slice(0, 15).map((s) => s.ticker),
      isSimulated: true,
    };
    this.gateway.emitNewEvent(simulatedEvent);

    // T+50ms: emit shock scores
    await this.delay(50);
    this.gateway.emitShockUpdate(result.shocks);

    // T+100ms: emit simulation result (heatmap/arcs for globe)
    await this.delay(50);
    this.gateway.emitSimulationResult({
      simulatedEventId: result.simulatedEventId,
      title: result.title,
      heatmap: result.heatmap,
      arcs: result.arcs,
      topAffectedSectors: result.topAffectedSectors,
    });

    // T+150ms+: staggered price updates for top 15 most-impacted stocks
    const topStocks = result.shocks.slice(0, 15);
    for (const shock of topStocks) {
      await this.delay(150);
      const seedStock = SEED_STOCKS.find((s) => s.ticker === shock.ticker);
      if (!seedStock) continue;

      const basePrice = seedStock.price;
      const newPrice = parseFloat(
        (basePrice * (1 + shock.predictedChange / 100)).toFixed(2),
      );
      const change = parseFloat((newPrice - basePrice).toFixed(2));

      this.gateway.emitPriceUpdate({
        ticker: shock.ticker,
        companyName: shock.companyName,
        sector: shock.sector,
        price: newPrice,
        previousPrice: basePrice,
        change,
        changePercent: shock.predictedChange,
        timestamp: new Date().toISOString(),
      });
    }

    this.logger.log(
      `Simulation broadcast complete: ${result.simulatedEventId} — ${topStocks.length} price updates emitted`,
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Aggregate shock scores into per-sector impact summaries.
   */
  private buildSectorImpacts(shocks: ShockScore[]): SectorImpact[] {
    const bySector = new Map<string, ShockScore[]>();
    for (const s of shocks) {
      const list = bySector.get(s.sector) ?? [];
      list.push(s);
      bySector.set(s.sector, list);
    }

    const impacts: SectorImpact[] = [];
    for (const [sector, sectorShocks] of bySector) {
      const avg =
        sectorShocks.reduce((sum, s) => sum + s.score, 0) /
        sectorShocks.length;
      const upCount = sectorShocks.filter(
        (s) => s.direction === 'up',
      ).length;
      const downCount = sectorShocks.filter(
        (s) => s.direction === 'down',
      ).length;

      let predictedDirection: 'up' | 'down' | 'mixed';
      if (upCount > 0 && downCount > 0) {
        predictedDirection = 'mixed';
      } else if (upCount > downCount) {
        predictedDirection = 'up';
      } else {
        predictedDirection = 'down';
      }

      impacts.push({
        sector,
        averageShockScore: parseFloat(avg.toFixed(3)),
        stockCount: sectorShocks.length,
        predictedDirection,
        topStocks: sectorShocks
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((s) => s.ticker),
      });
    }

    // Sort by average shock descending.
    impacts.sort((a, b) => b.averageShockScore - a.averageShockScore);

    return impacts;
  }

  /**
   * Generate a short UUID-like snippet (8 hex chars) using timestamp + random.
   */
  private generateIdSnippet(): string {
    const timePart = Date.now().toString(16).slice(-4);
    const randPart = Math.random().toString(16).slice(2, 6);
    return `${timePart}${randPart}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
