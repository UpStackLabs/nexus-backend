import { Injectable } from '@nestjs/common';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type {
  SimulationResult,
  SectorImpact,
  ShockScore,
  HeatmapEntry,
  ConnectionArc,
  Stock,
} from '../common/types/index.js';
import { SimulateEventDto, SimulateEventType } from './dto/simulate-event.dto.js';

/**
 * Maps each event type to the sectors that are primarily affected.
 * Sectors listed first receive the highest shock multiplier.
 */
const EVENT_SECTOR_MAP: Record<SimulateEventType, string[]> = {
  [SimulateEventType.MILITARY]: ['Defense', 'Energy', 'Industrials', 'Materials'],
  [SimulateEventType.ECONOMIC]: ['Finance', 'Technology', 'Industrials'],
  [SimulateEventType.POLICY]: ['Healthcare', 'Finance', 'Technology', 'Energy'],
  [SimulateEventType.NATURAL_DISASTER]: ['Materials', 'Energy', 'Industrials', 'Healthcare'],
  [SimulateEventType.GEOPOLITICAL]: ['Energy', 'Finance', 'Defense', 'Technology', 'Materials'],
};

/**
 * Rough country-center coordinates used for geographic proximity calculations
 * and heatmap generation.
 */
const COUNTRY_COORDS: Record<string, { lat: number; lng: number }> = {
  US: { lat: 39.83, lng: -98.58 },
  GB: { lat: 55.38, lng: -3.44 },
  TW: { lat: 23.7, lng: 120.96 },
  JP: { lat: 36.2, lng: 138.25 },
  DE: { lat: 51.17, lng: 10.45 },
  DK: { lat: 56.26, lng: 9.5 },
  AU: { lat: -25.27, lng: 133.78 },
};

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
      this.calculateStockShock(stock, dto, simulatedEventId, affectedSectors),
    );

    // Sort descending by absolute score so the most impacted stocks surface first.
    shocks.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    // ── Heatmap entries (one per unique country among affected stocks) ──
    const heatmap = this.buildHeatmap(shocks);

    // ── Connection arcs from event epicenter to each affected country ──
    const arcs = this.buildArcs(dto, shocks, simulatedEventId);

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
  // Private helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Calculate a mock shock score for a single stock given the event.
   *
   * The score blends:
   *   - sector relevance (highest weight)
   *   - geographic proximity to the event epicenter
   *   - a deterministic-ish pseudo-random jitter seeded by the ticker
   *   - event severity as a global multiplier
   */
  private calculateStockShock(
    stock: Stock,
    dto: SimulateEventDto,
    eventId: string,
    affectedSectors: string[],
  ): ShockScore {
    // Sector relevance: 0 to 1 — the earlier the sector appears in the map the higher the score.
    const sectorIndex = affectedSectors.indexOf(stock.sector);
    const sectorRelevance =
      sectorIndex >= 0 ? 1 - sectorIndex / (affectedSectors.length + 1) : 0.1;

    // Geographic proximity: inverse of normalised distance (0-1).
    const distance = this.haversineDistance(
      dto.location.lat,
      dto.location.lng,
      stock.location.lat,
      stock.location.lng,
    );
    const maxEarthDistance = 20_037; // half Earth circumference in km
    const geographicProximity = parseFloat(
      (1 - Math.min(distance / maxEarthDistance, 1)).toFixed(3),
    );

    // Deterministic jitter based on ticker char-codes so results are reproducible.
    const tickerHash = this.hashString(stock.ticker);
    const jitter = ((tickerHash % 200) - 100) / 1000; // -0.1 to +0.1

    // Severity multiplier (1-10 mapped to 0.1-1.0).
    const severityMultiplier = dto.severity / 10;

    // Composite score
    const rawScore =
      (0.45 * sectorRelevance +
        0.25 * geographicProximity +
        0.2 * (0.5 + jitter) +
        0.1 * severityMultiplier) *
      severityMultiplier;

    const score = parseFloat(Math.min(rawScore, 1).toFixed(3));
    const historicalSensitivity = parseFloat((0.4 + (tickerHash % 30) / 100).toFixed(3));
    const supplyChainLinkage = parseFloat((0.2 + (tickerHash % 50) / 200).toFixed(3));
    const similarityScore = parseFloat((sectorRelevance * 0.8 + 0.1).toFixed(3));
    const confidence = parseFloat(Math.min(0.5 + sectorRelevance * 0.4, 0.95).toFixed(2));

    const predictedChange = parseFloat(
      (score * (sectorIndex >= 0 && sectorIndex < 2 ? 1 : -1) * 8).toFixed(2),
    );
    const direction: 'up' | 'down' = predictedChange >= 0 ? 'up' : 'down';

    return {
      eventId,
      ticker: stock.ticker,
      companyName: stock.companyName,
      sector: stock.sector,
      country: stock.country,
      score,
      similarityScore,
      historicalSensitivity,
      geographicProximity,
      supplyChainLinkage,
      predictedChange,
      actualChange: null, // simulated — no real observation
      surpriseFactor: null,
      confidence,
      direction,
    };
  }

  /**
   * Build heatmap entries grouped by country.
   */
  private buildHeatmap(shocks: ShockScore[]): HeatmapEntry[] {
    const byCountry = new Map<string, ShockScore[]>();
    for (const s of shocks) {
      const list = byCountry.get(s.country) ?? [];
      list.push(s);
      byCountry.set(s.country, list);
    }

    const entries: HeatmapEntry[] = [];
    for (const [country, countryShocks] of byCountry) {
      const avgIntensity =
        countryShocks.reduce((sum, s) => sum + s.score, 0) / countryShocks.length;
      const coords = COUNTRY_COORDS[country] ?? { lat: 0, lng: 0 };
      const hasUp = countryShocks.some((s) => s.direction === 'up');
      const hasDown = countryShocks.some((s) => s.direction === 'down');

      entries.push({
        country,
        countryCode: country,
        lat: coords.lat,
        lng: coords.lng,
        shockIntensity: parseFloat(avgIntensity.toFixed(3)),
        affectedSectors: [...new Set(countryShocks.map((s) => s.sector))],
        topAffectedStocks: countryShocks
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((s) => s.ticker),
        direction: hasUp && hasDown ? 'mixed' : hasUp ? 'positive' : 'negative',
      });
    }

    return entries;
  }

  /**
   * Build connection arcs from the event epicenter to each affected country.
   */
  private buildArcs(
    dto: SimulateEventDto,
    shocks: ShockScore[],
    eventId: string,
  ): ConnectionArc[] {
    const countrySeen = new Set<string>();
    const arcs: ConnectionArc[] = [];

    for (const shock of shocks) {
      if (countrySeen.has(shock.country) || shock.score < 0.15) continue;
      countrySeen.add(shock.country);

      const coords = COUNTRY_COORDS[shock.country] ?? { lat: 0, lng: 0 };

      arcs.push({
        id: `${eventId}-arc-${shock.country}`,
        startLat: dto.location.lat,
        startLng: dto.location.lng,
        endLat: coords.lat,
        endLng: coords.lng,
        fromLabel: dto.location.country,
        toLabel: shock.country,
        shockIntensity: parseFloat(shock.score.toFixed(3)),
        direction: shock.direction === 'up' ? 'positive' : 'negative',
        color: shock.direction === 'up' ? '#22c55e' : '#ef4444',
        eventId,
        sector: shock.sector,
      });
    }

    return arcs;
  }

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

  // ──────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────

  /**
   * Haversine distance between two lat/lng pairs in kilometres.
   */
  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371; // Earth radius in km
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

  /**
   * Simple deterministic hash for a string — produces a positive integer.
   */
  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return Math.abs(hash);
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
