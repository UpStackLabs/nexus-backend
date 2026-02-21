import type {
  ShockScore,
  HeatmapEntry,
  ConnectionArc,
  Stock,
  EventType,
} from '../types/index.js';

/**
 * Maps each event type to the sectors that are primarily affected.
 * Sectors listed first receive the highest shock multiplier.
 *
 * Keyed by EventType string so both SimulateService (enum) and
 * GlobeService (seed-data string) can use the same map.
 */
export const EVENT_SECTOR_MAP: Record<string, string[]> = {
  military: ['Defense', 'Energy', 'Industrials', 'Materials'],
  economic: ['Finance', 'Technology', 'Industrials'],
  policy: ['Healthcare', 'Finance', 'Technology', 'Energy'],
  natural_disaster: ['Materials', 'Energy', 'Industrials', 'Healthcare'],
  geopolitical: ['Energy', 'Finance', 'Defense', 'Technology', 'Materials'],
};

/**
 * Rough country-center coordinates used for geographic proximity calculations
 * and heatmap generation. Supports both ISO codes and full country names.
 */
export const COUNTRY_COORDS: Record<string, { lat: number; lng: number }> = {
  // ISO codes
  US: { lat: 39.83, lng: -98.58 },
  GB: { lat: 55.38, lng: -3.44 },
  TW: { lat: 23.7, lng: 120.96 },
  JP: { lat: 36.2, lng: 138.25 },
  DE: { lat: 51.17, lng: 10.45 },
  DK: { lat: 56.26, lng: 9.5 },
  AU: { lat: -25.27, lng: 133.78 },
  BR: { lat: -15.8, lng: -47.89 },
  MX: { lat: 19.43, lng: -99.13 },
  IL: { lat: 31.05, lng: 34.85 },
  GR: { lat: 37.98, lng: 23.73 },
  VE: { lat: 10.48, lng: -66.9 },
  CO: { lat: 4.71, lng: -74.07 },
  SA: { lat: 24.71, lng: 46.68 },
  RU: { lat: 55.76, lng: 37.62 },
  CN: { lat: 39.9, lng: 116.41 },
  CA: { lat: 45.42, lng: -75.7 },
  NG: { lat: 9.08, lng: 8.68 },
  NO: { lat: 59.91, lng: 10.75 },
  CL: { lat: -33.45, lng: -70.67 },
  KR: { lat: 37.57, lng: 126.98 },
  FR: { lat: 48.86, lng: 2.35 },
  BE: { lat: 50.85, lng: 4.35 },

  // Full country names (mapped to same coords)
  USA: { lat: 39.83, lng: -98.58 },
  'United States': { lat: 39.83, lng: -98.58 },
  UK: { lat: 55.38, lng: -3.44 },
  'United Kingdom': { lat: 55.38, lng: -3.44 },
  Taiwan: { lat: 23.7, lng: 120.96 },
  Japan: { lat: 36.2, lng: 138.25 },
  Germany: { lat: 51.17, lng: 10.45 },
  Denmark: { lat: 56.26, lng: 9.5 },
  Australia: { lat: -25.27, lng: 133.78 },
  Brazil: { lat: -15.8, lng: -47.89 },
  Mexico: { lat: 19.43, lng: -99.13 },
  Israel: { lat: 31.05, lng: 34.85 },
  Greece: { lat: 37.98, lng: 23.73 },
  Venezuela: { lat: 10.48, lng: -66.9 },
  Colombia: { lat: 4.71, lng: -74.07 },
  'Saudi Arabia': { lat: 24.71, lng: 46.68 },
  Russia: { lat: 55.76, lng: 37.62 },
  China: { lat: 39.9, lng: 116.41 },
  Canada: { lat: 45.42, lng: -75.7 },
  Nigeria: { lat: 9.08, lng: 8.68 },
  Norway: { lat: 59.91, lng: 10.75 },
  Chile: { lat: -33.45, lng: -70.67 },
  'South Korea': { lat: 37.57, lng: 126.98 },
  France: { lat: 48.86, lng: 2.35 },
  Belgium: { lat: 50.85, lng: 4.35 },
};

// ──────────────────────────────────────────────────────────────────
// Pure utility functions
// ──────────────────────────────────────────────────────────────────

function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Haversine distance between two lat/lng pairs in kilometres.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = degToRad(lat2 - lat1);
  const dLng = degToRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Simple deterministic hash for a string — produces a positive integer.
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Calculate a shock score for a single stock given event parameters.
 *
 * Accepts plain values so it can be called from both SimulateService
 * and GlobeService without needing DTOs.
 */
export function calculateStockShock(
  stock: Stock,
  eventLocation: { lat: number; lng: number; country: string },
  eventId: string,
  affectedSectors: string[],
  severity: number,
): ShockScore {
  const sectorIndex = affectedSectors.indexOf(stock.sector);
  const sectorRelevance =
    sectorIndex >= 0 ? 1 - sectorIndex / (affectedSectors.length + 1) : 0.1;

  const distance = haversineDistance(
    eventLocation.lat,
    eventLocation.lng,
    stock.location.lat,
    stock.location.lng,
  );
  const maxEarthDistance = 20_037;
  const geographicProximity = parseFloat(
    (1 - Math.min(distance / maxEarthDistance, 1)).toFixed(3),
  );

  const tickerHash = hashString(stock.ticker);
  const jitter = ((tickerHash % 200) - 100) / 1000;

  const severityMultiplier = severity / 10;

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
    actualChange: null,
    surpriseFactor: null,
    confidence,
    direction,
  };
}

/**
 * Build heatmap entries grouped by country from an array of shock scores.
 */
export function buildHeatmapFromShocks(shocks: ShockScore[]): HeatmapEntry[] {
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
export function buildArcsFromShocks(
  eventLocation: { lat: number; lng: number; country: string },
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
      startLat: eventLocation.lat,
      startLng: eventLocation.lng,
      endLat: coords.lat,
      endLng: coords.lng,
      fromLabel: eventLocation.country,
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
