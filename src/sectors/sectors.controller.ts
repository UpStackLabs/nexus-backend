import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SectorsService } from './sectors.service.js';
import type { SectorData } from './sectors.service.js';

@ApiTags('Sectors')
@Controller('sectors')
export class SectorsController {
  constructor(private readonly sectorsService: SectorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get sector-level aggregate shock data',
    description:
      'Returns sector-level aggregated data including stock count, average shock score, predicted direction, and top affected stocks per sector.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sector data retrieved successfully',
  })
  getSectors(): SectorData[] {
    return this.sectorsService.getSectors();
  }
}
