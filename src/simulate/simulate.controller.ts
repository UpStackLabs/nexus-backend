import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { SimulateService } from './simulate.service.js';
import { SimulateEventDto } from './dto/simulate-event.dto.js';
import type { SimulationResult } from '../common/types/index.js';

@ApiTags('Simulation')
@Controller('simulate')
export class SimulateController {
  constructor(private readonly simulateService: SimulateService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run a what-if event simulation',
    description:
      'Accepts a hypothetical event and returns simulated shock scores, heatmap data, ' +
      'connection arcs, and sector impact analysis for the entire stock universe.',
  })
  @ApiBody({ type: SimulateEventDto })
  @ApiResponse({
    status: 200,
    description: 'Simulation completed successfully. Returns the full SimulationResult.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body — validation errors.',
  })
  async runSimulation(@Body() dto: SimulateEventDto): Promise<SimulationResult> {
    return this.simulateService.runSimulation(dto);
  }
}
