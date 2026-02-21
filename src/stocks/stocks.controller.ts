import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { StocksService } from './stocks.service.js';
import { QueryStocksDto } from './dto/query-stocks.dto.js';
import type { StockAnalysis } from '../common/types/index.js';

@ApiTags('Stocks')
@Controller('stocks')
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @Get()
  @ApiOperation({ summary: 'List all stocks with optional filters' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of stocks matching the given filters',
  })
  findAll(@Query() query: QueryStocksDto) {
    return this.stocksService.findAll(query);
  }

  @Get(':ticker/analysis')
  @ApiOperation({ summary: 'Get full shock analysis for a stock' })
  @ApiParam({
    name: 'ticker',
    description: 'Stock ticker symbol (e.g. AAPL, TSM, XOM)',
    example: 'XOM',
  })
  @ApiResponse({
    status: 200,
    description: 'Full shock analysis including relevant events and composite score',
  })
  @ApiResponse({ status: 404, description: 'Stock not found' })
  getAnalysis(@Param('ticker') ticker: string): Promise<StockAnalysis> {
    return this.stocksService.getAnalysis(ticker);
  }

  @Get(':ticker')
  @ApiOperation({ summary: 'Get stock detail with shock history' })
  @ApiParam({
    name: 'ticker',
    description: 'Stock ticker symbol (e.g. AAPL, TSM, XOM)',
    example: 'AAPL',
  })
  @ApiResponse({
    status: 200,
    description: 'Stock detail including full shock history',
  })
  @ApiResponse({
    status: 404,
    description: 'Stock not found',
  })
  findOne(@Param('ticker') ticker: string) {
    return this.stocksService.findOne(ticker);
  }

  @Get(':ticker/surprise')
  @ApiOperation({ summary: 'Get surprise factor analysis for a stock' })
  @ApiParam({
    name: 'ticker',
    description: 'Stock ticker symbol (e.g. AAPL, TSM, XOM)',
    example: 'AAPL',
  })
  @ApiResponse({
    status: 200,
    description: 'Surprise factor analysis including anomaly detection',
  })
  @ApiResponse({
    status: 404,
    description: 'Stock not found',
  })
  getSurpriseAnalysis(@Param('ticker') ticker: string) {
    return this.stocksService.getSurpriseAnalysis(ticker);
  }
}
