import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class QueryStocksDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by sector (e.g. Technology, Energy, Finance)' })
  @IsOptional()
  @IsString()
  sector?: string;

  @ApiPropertyOptional({ description: 'Filter by country code (e.g. US, GB, TW)' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Filter by exchange (e.g. NYSE, NASDAQ, LSE)' })
  @IsOptional()
  @IsString()
  exchange?: string;
}
