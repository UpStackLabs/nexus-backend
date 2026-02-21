export interface HeatmapEntry {
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  shockIntensity: number; // 0-1 normalized
  affectedSectors: string[];
  topAffectedStocks: string[];
  direction: 'positive' | 'negative' | 'mixed';
}

export interface ConnectionArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  fromLabel: string;
  toLabel: string;
  shockIntensity: number; // 0-1 for arc thickness
  direction: 'positive' | 'negative';
  color: string; // hex color
  eventId: string;
  sector?: string;
}

export interface GlobeData {
  heatmap: HeatmapEntry[];
  arcs: ConnectionArc[];
  eventMarkers: EventMarker[];
}

export interface EventMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  type: string;
  severity: number;
  isEpicenter: boolean;
  rippleRadius: number;
}
