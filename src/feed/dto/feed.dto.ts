import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { URGENCY_LEVELS } from '../../jobs/dto/create-job.dto.js';

export class FeedQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to one city' })
  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({
    type: [String], format: 'uuid',
    description: 'Narrow to a subset of the services I offer. Defaults to all of them.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value))
  @IsArray() @IsUUID('4', { each: true })
  serviceIds?: string[];

  @ApiPropertyOptional({ enum: URGENCY_LEVELS })
  @IsOptional() @IsIn(URGENCY_LEVELS)
  urgency?: (typeof URGENCY_LEVELS)[number];

  @ApiPropertyOptional({ example: 10000, description: 'Only jobs whose budget reaches this amount' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  minBudget?: number;

  @ApiPropertyOptional({ example: 10, description: 'Cap the distance from my service areas, in km' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maxDistanceKm?: number;

  @ApiPropertyOptional({ description: 'Free-text search across title and description' })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;
}

export class FeedJobDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'The customer own description, verbatim' }) description: string;
  @ApiProperty({ example: 'RECEIVING_APPLICATIONS' }) status: string;
  @ApiProperty({ enum: URGENCY_LEVELS }) urgency: string;
  @ApiProperty({ format: 'uuid' }) service_id: string;
  @ApiProperty({ example: 'AC Servicing' }) service_name: string;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) sub_service_id: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) category_id: string | null;
  @ApiPropertyOptional({ nullable: true }) category_name: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) budget_min: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) budget_max: number | null;
  @ApiProperty({ example: 'NEGOTIABLE' }) budget_type: string;
  @ApiProperty({ example: 'NGN' }) currency: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) preferred_start_at: string | null;
  @ApiPropertyOptional({ nullable: true }) preferred_time_notes: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Neighbourhood only. The street address is withheld until selection.' })
  neighbourhood: string | null;
  @ApiPropertyOptional({ nullable: true }) city: string | null;
  @ApiPropertyOptional({ nullable: true }) state: string | null;

  @ApiPropertyOptional({
    nullable: true, type: Number,
    description: 'Coordinates coarsened to ~1km so a job cannot be pinpointed from the feed.',
  })
  latitude_approx: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) longitude_approx: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Km from my nearest service area' })
  distance_km: number | null;

  @ApiProperty({ example: 3 }) applications_count: number;
  @ApiProperty({ example: 2, description: 'How many photos/videos the customer attached' }) media_count: number;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) published_at: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) expires_at: string | null;

  @ApiProperty({ example: 68.42, type: Number, description: 'Deterministic relevance score used for ordering' })
  relevance_score: number;
}
