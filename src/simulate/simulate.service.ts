import { Injectable } from '@nestjs/common';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type {
  SimulationResult,
  SectorImpact,
  ShockScore,
} from '../common/types/index.js';
import { SimulateEventDto } from './dto/simulate-event.dto.js';
import {
  EVENT_SECTOR_MAP,
  calculateStockShock,
  buildHeatmapFromShocks,
  buildArcsFromShocks,
} from '../common/utils/shock-calc.js';

@Injectable()
export class SimulateService {
  /**
   * Run a what-if simulation for the given event parameters.
   *
   * The simulation:
   * 1. Generates a unique simulation event ID.
   * 2. Calculates a shock score for every stock in the seed universe.
   * 3. Builds heatmap entries and connection arcs for globe visualisation.
   * 4. Aggregates sector-level impact summaries.
   */
  runSimulation(dto: SimulateEventDto): SimulationResult {
    const simulatedEventId = `sim-${this.generateIdSnippet()}`;
    const affectedSectors = EVENT_SECTOR_MAP[dto.type] ?? [];

    // ── Per-stock shock calculation ──────────────────────────────────
    const shocks: ShockScore[] = SEED_STOCKS.map((stock) =>
      calculateStockShock(stock, dto.location, simulatedEventId, affectedSectors, dto.severity),
    );

    // Sort descending by absolute score so the most impacted stocks surface first.
    shocks.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    // ── Heatmap entries (one per unique country among affected stocks) ──
    const heatmap = buildHeatmapFromShocks(shocks);

    // ── Connection arcs from event epicenter to each affected country ──
    const arcs = buildArcsFromShocks(dto.location, shocks, simulatedEventId);

    // ── Sector impact aggregation ────────────────────────────────────
    const topAffectedSectors = this.buildSectorImpacts(shocks);

    // ── Interlinkedness (simplified: ratio of significantly shocked stocks) ──
    const significantlyShocked = shocks.filter((s) => Math.abs(s.score) > 0.3);
    const interlinkednessScore = parseFloat(
      (significantlyShocked.length / Math.max(shocks.length, 1)).toFixed(3),
    );

    const affectedCountries = new Set(shocks.filter((s) => s.score > 0.1).map((s) => s.country));

    return {
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
  }

  // ──────────────────────────────────────────────────────────────────
  // Private helpers (simulation-specific)
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
      const avg = sectorShocks.reduce((sum, s) => sum + s.score, 0) / sectorShocks.length;
      const upCount = sectorShocks.filter((s) => s.direction === 'up').length;
      const downCount = sectorShocks.filter((s) => s.direction === 'down').length;

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
}
