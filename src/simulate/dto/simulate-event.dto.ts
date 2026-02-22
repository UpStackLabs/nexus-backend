import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LocationDto {
  @ApiProperty({
    description: 'Latitude of the event location',
    example: 33.88,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({
    description: 'Longitude of the event location',
    example: 35.5,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiProperty({
    description: 'ISO country code or country name where the event occurs',
    example: 'US',
  })
  @IsString()
  @IsNotEmpty()
  country: string;
}

export enum SimulateEventType {
  MILITARY = 'military',
  ECONOMIC = 'economic',
  POLICY = 'policy',
  NATURAL_DISASTER = 'natural_disaster',
  GEOPOLITICAL = 'geopolitical',
}

export class SimulateEventDto {
  @ApiProperty({
    description: 'Title of the simulated event',
    example: 'Escalation of military conflict in the Middle East',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the what-if event scenario',
    example:
      'A hypothetical large-scale military escalation disrupting oil supply routes in the Strait of Hormuz.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Category of the simulated event',
    enum: SimulateEventType,
    example: SimulateEventType.MILITARY,
  })
  @IsEnum(SimulateEventType)
  type: SimulateEventType;

  @ApiProperty({
    description: 'Severity of the event on a scale of 1 (minor) to 10 (catastrophic)',
    example: 8,
    minimum: 1,
    maximum: 10,
  })
  @IsNumber()
  @Min(1)
  @Max(10)
  severity: number;

  @ApiProperty({
    description: 'Geographic location of the event epicenter',
    type: LocationDto,
  })
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;
}
