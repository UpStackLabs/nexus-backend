import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export enum EventType {
  MILITARY = 'military',
  ECONOMIC = 'economic',
  POLICY = 'policy',
  NATURAL_DISASTER = 'natural_disaster',
  GEOPOLITICAL = 'geopolitical',
}

export class QueryEventsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: EventType,
    description: 'Filter by event type',
    example: EventType.GEOPOLITICAL,
  })
  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  @ApiPropertyOptional({
    description: 'Minimum severity (1-10)',
    minimum: 1,
    maximum: 10,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  minSeverity?: number;

  @ApiPropertyOptional({
    description: 'Maximum severity (1-10)',
    minimum: 1,
    maximum: 10,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  maxSeverity?: number;

  @ApiPropertyOptional({
    description: 'Filter by start date (ISO 8601)',
    example: '2025-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by end date (ISO 8601)',
    example: '2025-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by affected country (ISO 3166-1 alpha-2 or country name)',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  country?: string;
}
