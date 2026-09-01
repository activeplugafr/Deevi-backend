import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, MaxLength,
} from 'class-validator';

export const SAVED_LOCATION_SOURCES = ['MANUAL', 'MAP', 'DEVICE', 'IMPORTED'] as const;

export class CreateLocationDto {
  @ApiProperty({ example: 'Home', description: 'A label the customer recognises' })
  @IsString() @IsNotEmpty() @MaxLength(60)
  label: string;

  @ApiPropertyOptional({ example: '14 Adeola Odeku Street' })
  @IsOptional() @IsString() @MaxLength(300)
  addressLine?: string;

  @ApiPropertyOptional({ example: 'Victoria Island' })
  @IsOptional() @IsString() @MaxLength(120)
  neighbourhood?: string;

  @ApiPropertyOptional({ example: 'Lagos Island' })
  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional() @IsString() @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({ example: 'NG', default: 'NG' })
  @IsOptional() @IsString() @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({ example: 6.4281, description: 'From the map picker or the device GPS' })
  @IsOptional() @Type(() => Number) @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 3.4219 })
  @IsOptional() @Type(() => Number) @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Blue gate, second building on the left' })
  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    enum: SAVED_LOCATION_SOURCES,
    default: 'MANUAL',
    description: 'How the coordinates were captured. MAP and DEVICE are trusted for distance ranking.',
  })
  @IsOptional() @IsIn(SAVED_LOCATION_SOURCES)
  source?: (typeof SAVED_LOCATION_SOURCES)[number];

  @ApiPropertyOptional({ default: false, description: 'Pre-select this location on new job posts' })
  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class UpdateLocationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) neighbourhood?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) state?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class LocationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Home' }) label: string;
  @ApiPropertyOptional({ nullable: true }) address_line: string | null;
  @ApiPropertyOptional({ nullable: true }) neighbourhood: string | null;
  @ApiPropertyOptional({ nullable: true }) city: string | null;
  @ApiPropertyOptional({ nullable: true }) state: string | null;
  @ApiProperty({ example: 'NG' }) country: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) latitude: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) longitude: number | null;
  @ApiPropertyOptional({ nullable: true }) notes: string | null;
  @ApiProperty() is_default: boolean;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}
