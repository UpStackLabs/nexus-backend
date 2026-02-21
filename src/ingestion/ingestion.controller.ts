import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IngestionService } from './ingestion.service.js';
import { NewsIngestionService } from './news-ingestion.service.js';

@ApiTags('Ingestion')
@Controller('ingest')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly newsIngestion: NewsIngestionService,
  ) {}

  @Get('news')
  @ApiOperation({ summary: 'Get cached news articles for display (refreshes every 10 min)' })
  @ApiResponse({ status: 200, description: 'Array of news display items' })
  getNews() {
    return this.newsIngestion.getCachedNews();
  }

  @Post()
  @ApiOperation({ summary: 'Manually trigger event ingestion pipeline' })
  @ApiResponse({ status: 201, description: 'Ingestion summary' })
  triggerIngestion() {
    return this.ingestionService.runManualIngestion();
  }

  @Post('articles')
  @ApiOperation({ summary: 'Submit pre-fetched articles for NLP classification and storage' })
  @ApiResponse({ status: 201, description: 'Ingestion summary' })
  submitArticles(@Body() body: { articles: { title: string; text: string; source: string; publishedAt?: string }[] }) {
    return this.ingestionService.processArticles(body.articles ?? []);
  }
}
