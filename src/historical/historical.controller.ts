import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HistoricalService } from './historical.service.js';
import { SimilarQueryDto } from './dto/similar-query.dto.js';
import type { ShockEvent } from '../common/types/index.js';

@ApiTags('Historical')
@Controller('historical')
export class HistoricalController {
  constructor(private readonly historicalService: HistoricalService) {}

  @Get('similar')
  @ApiOperation({
    summary: 'Find similar historical events',
    description:
      'Find historical events similar to a given event (by ID) or text description. Results are ranked by relevance. If an eventId is provided, returns events of the same type ranked by severity similarity. If a description is provided, performs keyword matching against event titles and descriptions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Similar events retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters',
  })
  findSimilar(@Query() query: SimilarQueryDto): ShockEvent[] {
    return this.historicalService.findSimilar(query);
  }
}
