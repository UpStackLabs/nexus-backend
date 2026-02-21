import { IsString, IsUrl, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyzeImageDto {
  @ApiProperty({
    description: 'URL of the image to analyze (satellite, CCTV, news photo)',
    example: 'https://example.com/satellite-image.jpg',
  })
  @IsString()
  @IsUrl()
  imageUrl: string;

  @ApiPropertyOptional({
    description: 'Optional context about the image source or location',
    example: 'Satellite imagery of Venezuela-Guyana border region',
  })
  @IsOptional()
  @IsString()
  context?: string;

  @ApiPropertyOptional({
    description: 'Geographic coordinates of the image',
    example: '6.0, -61.0',
  })
  @IsOptional()
  @IsString()
  coordinates?: string;
}
