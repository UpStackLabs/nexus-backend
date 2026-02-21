import { Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IngestionService } from './ingestion.service.js';

@ApiTags('Ingestion')
@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @ApiOperation({ summary: 'Manually trigger event ingestion pipeline' })
  @ApiResponse({ status: 201, description: 'Ingestion summary' })
  triggerIngestion() {
    return this.ingestionService.runManualIngestion();
  }
}
