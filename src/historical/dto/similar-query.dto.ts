import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SimilarQueryDto {
  @ApiPropertyOptional({
    description: 'Find events similar to this event ID',
    example: 'evt-001',
  })
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiPropertyOptional({
    description: 'Find events similar to this text description',
    example: 'trade sanctions on semiconductor exports',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    default: 5,
    minimum: 1,
    maximum: 20,
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
