export type EventType =
  | 'military'
  | 'economic'
  | 'policy'
  | 'natural_disaster'
  | 'geopolitical';

export interface GeoLocation {
  lat: number;
  lng: number;
  country: string;
  region?: string;
}

export interface ShockEvent {
  id: string;
  title: string;
  description: string;
  type: EventType;
  severity: number; // 1-10
  location: GeoLocation;
  timestamp: string; // ISO 8601
  source: string;
  affectedCountries: string[];
  affectedSectors: string[];
  affectedTickers: string[];
  isSimulated: boolean;
}
