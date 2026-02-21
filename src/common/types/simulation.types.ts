import type { EventType } from './event.types.js';
import type { ShockScore } from './shock.types.js';
import type { HeatmapEntry, ConnectionArc } from './globe.types.js';

export interface SimulationRequest {
  title: string;
  description: string;
  type: EventType;
  severity: number;
  location: {
    lat: number;
    lng: number;
    country: string;
  };
}

export interface SimulationResult {
  simulatedEventId: string;
  title: string;
  shocks: ShockScore[];
  heatmap: HeatmapEntry[];
  arcs: ConnectionArc[];
  interlinkednessScore: number;
  totalAffectedCompanies: number;
  totalAffectedCountries: number;
  topAffectedSectors: SectorImpact[];
}

export interface SectorImpact {
  sector: string;
  averageShockScore: number;
  stockCount: number;
  predictedDirection: 'up' | 'down' | 'mixed';
  topStocks: string[];
}
