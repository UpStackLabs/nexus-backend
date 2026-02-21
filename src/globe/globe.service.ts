import { Injectable } from '@nestjs/common';
import { SEED_HEATMAP, SEED_ARCS, SEED_EVENTS } from '../common/data/seed-data.js';
import type {
  HeatmapEntry,
  ConnectionArc,
  EventMarker,
  ShockEvent,
} from '../common/types/index.js';

@Injectable()
export class GlobeService {
  getHeatmap(eventId?: string): HeatmapEntry[] {
    if (eventId) {
      const event = SEED_EVENTS.find((e: ShockEvent) => e.id === eventId);
      if (!event) {
        return [];
      }
      const affectedCountries = event.affectedCountries;
      return SEED_HEATMAP.filter((entry: HeatmapEntry) =>
        affectedCountries.includes(entry.countryCode),
      );
    }
    return SEED_HEATMAP;
  }

  getArcs(eventId?: string): ConnectionArc[] {
    if (eventId) {
      return SEED_ARCS.filter(
        (arc: ConnectionArc) => arc.eventId === eventId,
      );
    }
    return SEED_ARCS;
  }

  getEventMarkers(): EventMarker[] {
    return SEED_EVENTS.map((event: ShockEvent) => ({
      id: event.id,
      lat: event.location.lat,
      lng: event.location.lng,
      title: event.title,
      type: event.type,
      severity: event.severity,
      isEpicenter: true,
      rippleRadius: event.severity * 10,
    }));
  }
}
