import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { EventsService } from './events.service.js';
import { QueryEventsDto } from './dto/query-events.dto.js';

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List events with filters' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of events matching the provided filters.',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryEventsDto,
  ) {
    return this.eventsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event details' })
  @ApiParam({
    name: 'id',
    description: 'Unique event identifier',
    example: 'evt-001',
  })
  @ApiResponse({ status: 200, description: 'The event details.' })
  @ApiResponse({ status: 404, description: 'Event not found.' })
  findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Get(':id/shocks')
  @ApiOperation({ summary: 'Get shock scores for event' })
  @ApiParam({
    name: 'id',
    description: 'Unique event identifier',
    example: 'evt-001',
  })
  @ApiResponse({
    status: 200,
    description: 'Shock scores associated with the event.',
  })
  @ApiResponse({ status: 404, description: 'Event not found.' })
  getShocks(@Param('id') id: string) {
    return this.eventsService.getShocks(id);
  }
}
