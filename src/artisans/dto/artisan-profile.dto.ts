import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'BUSY', 'UNAVAILABLE'] as const;
export const PRICE_UNITS = ['PER_JOB', 'PER_HOUR', 'PER_DAY', 'PER_UNIT', 'NEGOTIABLE'] as const;

export class UpdateArtisanProfileDto {
  @ApiPropertyOptional({ example: 'Certified plumber, 8 years in Lagos' })
  @IsOptional() @IsString() @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional({ example: 'I handle leaks, tank installation and full bathroom fittings.' })
  @IsOptional() @IsString() @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ example: 'Chidi Plumbing Works' })
  @IsOptional() @IsString() @MaxLength(160)
  businessName?: string;

  @ApiPropertyOptional({ example: 8, minimum: 0, maximum: 70 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(70)
  yearsOfExperience?: number;

  @ApiPropertyOptional({ example: 'Surulere', description: 'Where the artisan is normally based' })
  @IsOptional() @IsString() @MaxLength(120)
  baseCity?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional() @IsString() @MaxLength(120)
  baseState?: string;

  @ApiPropertyOptional({ example: 6.4969 })
  @IsOptional() @Type(() => Number) @IsLatitude()
  baseLatitude?: number;

  @ApiPropertyOptional({ example: 3.3481 })
  @IsOptional() @Type(() => Number) @IsLongitude()
  baseLongitude?: number;

  @ApiPropertyOptional({
    example: 15, minimum: 1, maximum: 200,
    description: 'How far the artisan will travel. Used as a hard filter on the job feed.',
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  maxTravelKm?: number;

  @ApiPropertyOptional({ enum: AVAILABILITY_STATUSES })
  @IsOptional() @IsIn(AVAILABILITY_STATUSES)
  availabilityStatus?: (typeof AVAILABILITY_STATUSES)[number];
}

export class ArtisanServiceInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() serviceId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  subServiceId?: string;

  @ApiPropertyOptional({ example: 15000, description: 'Indicative floor price, in NGN' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ example: 45000 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({ enum: PRICE_UNITS, default: 'PER_JOB' })
  @IsOptional() @IsIn(PRICE_UNITS)
  priceUnit?: (typeof PRICE_UNITS)[number];

  @ApiPropertyOptional({ example: 5 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(70)
  yearsExperience?: number;
}

export class SetArtisanServicesDto {
  @ApiProperty({
    type: [ArtisanServiceInputDto],
    description: 'Replaces the artisan services list wholesale. Send the complete desired set.',
  })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ArtisanServiceInputDto)
  services: ArtisanServiceInputDto[];
}
