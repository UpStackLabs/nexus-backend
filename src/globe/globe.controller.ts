import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { GlobeService } from './globe.service.js';
import type {
  HeatmapEntry,
  ConnectionArc,
  EventMarker,
} from '../common/types/index.js';

@ApiTags('Globe')
@Controller('globe')
export class GlobeController {
  constructor(private readonly globeService: GlobeService) {}

  @Get('heatmap')
  @ApiOperation({
    summary: 'Get country-level shock intensity data',
    description:
      'Returns heatmap entries representing shock intensity per country for globe rendering. Optionally filter by a specific event.',
  })
  @ApiQuery({
    name: 'eventId',
    required: false,
    type: String,
    description: 'Filter heatmap data by a specific event ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Heatmap data retrieved successfully',
  })
  getHeatmap(@Query('eventId') eventId?: string): HeatmapEntry[] {
    return this.globeService.getHeatmap(eventId);
  }

  @Get('arcs')
  @ApiOperation({
    summary: 'Get connection arcs for globe rendering',
    description:
      'Returns connection arcs representing shock propagation paths between countries. Optionally filter by a specific event.',
  })
  @ApiQuery({
    name: 'eventId',
    required: false,
    type: String,
    description: 'Filter arcs by a specific event ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Connection arcs retrieved successfully',
  })
  getArcs(@Query('eventId') eventId?: string): ConnectionArc[] {
    return this.globeService.getArcs(eventId);
  }

  @Get('markers')
  @ApiOperation({
    summary: 'Get event markers for globe',
    description:
      'Returns event markers with geographic coordinates, type, severity, and epicenter information for globe visualization.',
  })
  @ApiResponse({
    status: 200,
    description: 'Event markers retrieved successfully',
  })
  getEventMarkers(): EventMarker[] {
    return this.globeService.getEventMarkers();
  }

  @Get('vector-proximity')
  @ApiOperation({
    summary: 'Vector-DB proximity heatmap for a specific event',
    description:
      'Embeds the event text, queries the vector DB for historically similar events, and returns their affected countries as proximity-weighted heatmap entries. Returns [] if the vector DB is unavailable.',
  })
  @ApiQuery({
    name: 'eventId',
    required: true,
    type: String,
    description: 'Event ID to find vector-similar country exposure for',
  })
  @ApiResponse({
    status: 200,
    description: 'Vector proximity heatmap entries',
  })
  getVectorProximity(@Query('eventId') eventId: string): Promise<HeatmapEntry[]> {
    return this.globeService.getVectorProximity(eventId);
  }
}
