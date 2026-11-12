import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { BUDGET_TYPES, URGENCY_LEVELS } from './create-job.dto.js';

export const JOB_POST_STATUSES = [
  'DRAFT', 'PUBLISHED', 'RECEIVING_APPLICATIONS', 'ARTISAN_SELECTED',
  'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'EXPIRED',
] as const;

export class MyJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JOB_POST_STATUSES, description: 'Filter by lifecycle status' })
  @IsOptional() @IsIn(JOB_POST_STATUSES)
  status?: (typeof JOB_POST_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Only open posts (PUBLISHED or RECEIVING_APPLICATIONS)' })
  @IsOptional() @IsIn(['open', 'active', 'closed'])
  bucket?: 'open' | 'active' | 'closed';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) q?: string;
}

export class UpdateJobPostDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;

  @ApiPropertyOptional({ enum: URGENCY_LEVELS })
  @IsOptional() @IsIn(URGENCY_LEVELS) urgency?: (typeof URGENCY_LEVELS)[number];

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) budgetMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) budgetMax?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) transportFare?: number;


  @ApiPropertyOptional({ enum: BUDGET_TYPES })
  @IsOptional() @IsIn(BUDGET_TYPES) budgetType?: (typeof BUDGET_TYPES)[number];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString() preferredStartAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) preferredTimeNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) additionalNotes?: string;
}

export class CancelJobDto {
  @ApiProperty({ example: 'I fixed it myself in the end' })
  @IsString() @MaxLength(500)
  reason: string;
}

export class DeclineJobDto {
  @ApiPropertyOptional({ example: 'I am no longer free on that date' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class JobPostSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: JOB_POST_STATUSES }) status: string;
  @ApiProperty({ enum: URGENCY_LEVELS }) urgency: string;
  @ApiProperty({ format: 'uuid' }) service_id: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) budget_min: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) budget_max: number | null;
  @ApiProperty({ example: 'NGN' }) currency: string;
  @ApiPropertyOptional({ nullable: true }) neighbourhood: string | null;
  @ApiPropertyOptional({ nullable: true }) city: string | null;
  @ApiProperty({ example: 3 }) applications_count: number;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) published_at: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}
