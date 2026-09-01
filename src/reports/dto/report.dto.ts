import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export const REPORT_CATEGORIES = [
  'NO_SHOW', 'POOR_WORKMANSHIP', 'INAPPROPRIATE_BEHAVIOUR', 'MISLEADING_LISTING',
  'MISLEADING_PROFILE', 'PRICING_ISSUE', 'INCOMPLETE_SERVICE', 'SAFETY_CONCERN',
  'PAYMENT_ISSUE', 'SPAM', 'FRAUD', 'OTHER',
] as const;

export const REPORT_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] as const;

export class CreateReportDto {
  @ApiProperty({
    enum: REPORT_CATEGORIES,
    description: 'SAFETY_CONCERN and FRAUD are automatically escalated to URGENT priority.',
  })
  @IsIn(REPORT_CATEGORIES)
  category: (typeof REPORT_CATEGORIES)[number];

  @ApiProperty({ example: 'The artisan did not show up and stopped replying to messages.' })
  @IsString() @MinLength(15) @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The user being reported' })
  @IsOptional() @IsUUID()
  reportedUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  jobPostId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'A specific message being reported' })
  @IsOptional() @IsUUID()
  messageId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Public URLs of supporting evidence' })
  @IsOptional() @IsArray() @IsString({ each: true })
  evidenceUrls?: string[];
}

export class CreateDisputeDto {
  @ApiProperty({ format: 'uuid', description: 'The engagement in dispute' })
  @IsUUID()
  jobId: string;

  @ApiProperty({ example: 'Work was left unfinished and the artisan will not return' })
  @IsString() @MinLength(15) @MaxLength(500)
  reason: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) details?: string;
}

export class MyReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional() @IsIn(REPORT_STATUSES)
  status?: (typeof REPORT_STATUSES)[number];
}

export class ReportDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'RPT-A1B2C3D4E5', description: 'Quote this to Deevi support' }) reference: string;
  @ApiProperty({ enum: REPORT_CATEGORIES }) category: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: REPORT_STATUSES }) status: string;
  @ApiProperty({ example: 'NORMAL' }) priority: string;
  @ApiPropertyOptional({ nullable: true }) resolution: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) resolved_at: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}

export class DisputeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'DSP-A1B2C3D4E5' }) reference: string;
  @ApiProperty({ format: 'uuid' }) job_id: string;
  @ApiProperty() reason: string;
  @ApiProperty({ enum: REPORT_STATUSES }) status: string;
  @ApiPropertyOptional({ nullable: true }) resolution: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}
