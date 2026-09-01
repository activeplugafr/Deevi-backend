import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn, IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength,
} from 'class-validator';

export const LOCATION_SOURCES = ['MANUAL', 'MAP', 'DEVICE', 'SAVED'] as const;

/**
 * A service location. Deliberately independent of the customer's profile
 * address: someone living in Igando can absolutely book a job in Obalende.
 */
export class ServiceLocationDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Reuse one of the customer saved locations' })
  @IsOptional()
  @IsString()
  savedLocationId?: string;

  @ApiPropertyOptional({ description: 'Street address. Private: never shown in the public feed.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Obalende' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighbourhood?: string;

  @ApiPropertyOptional({ example: 'Lagos Island' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({ example: 'NG', default: 'NG' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({ example: 6.4474 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 3.4064 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Landmarks or access notes. Private.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationNotes?: string;

  @ApiPropertyOptional({ enum: LOCATION_SOURCES, default: 'MANUAL' })
  @IsOptional()
  @IsIn(LOCATION_SOURCES)
  source?: (typeof LOCATION_SOURCES)[number];
}

export class CoordinatesDto {
  @ApiProperty({ example: 6.4474 })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: 3.4064 })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  longitude: number;
}
