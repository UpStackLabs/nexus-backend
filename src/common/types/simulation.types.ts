import type { ShockScore } from './shock.types.js';
import type { HeatmapEntry, ConnectionArc } from './globe.types.js';

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
