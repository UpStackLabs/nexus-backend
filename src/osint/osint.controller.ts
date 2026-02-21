import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OsintService, OsintAnalysisResult } from './osint.service.js';
import { AnalyzeImageDto } from './dto/analyze-image.dto.js';

@ApiTags('OSINT')
@Controller('osint')
export class OsintController {
  constructor(private readonly osintService: OsintService) {}

  @Post('analyze')
  @ApiOperation({
    summary: 'Analyze a satellite/CCTV image for OSINT intelligence',
    description:
      'Accepts an image URL, runs YOLOv8 object detection + CLIP scene classification, ' +
      'classifies the event, embeds it in VectorAI DB, and broadcasts to connected clients. ' +
      'Falls back to mock analysis when model server is unavailable.',
  })
  @ApiResponse({
    status: 201,
    description: 'OSINT analysis result with detections and classifications',
  })
  async analyzeImage(
    @Body() dto: AnalyzeImageDto,
  ): Promise<OsintAnalysisResult> {
    return this.osintService.analyzeImage(
      dto.imageUrl,
      dto.context,
      dto.coordinates,
    );
  }
}
