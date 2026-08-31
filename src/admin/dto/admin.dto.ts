import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { REPORT_STATUSES } from '../../reports/dto/report.dto.js';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT', 'VERIFICATION', 'FINANCE'] as const;
export const VERIFICATION_DECISIONS = ['APPROVED', 'REJECTED', 'UNDER_REVIEW'] as const;

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search name, email or phone' })
  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: ['CUSTOMER', 'ARTISAN', 'ADMIN'] })
  @IsOptional() @IsIn(['CUSTOMER', 'ARTISAN', 'ADMIN'])
  role?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] })
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status?: string;
}

export class AdminArtisansQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] })
  @IsOptional() @IsIn(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  verificationStatus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() serviceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) q?: string;
}

export class ReviewApplicationDto {
  @ApiProperty({ enum: VERIFICATION_DECISIONS })
  @IsIn(VERIFICATION_DECISIONS)
  decision: (typeof VERIFICATION_DECISIONS)[number];

  @ApiPropertyOptional({ description: 'Internal notes, not shown to the artisan' })
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Shown to the artisan. Required when rejecting -- a rejection without a reason is unactionable.',
  })
  @IsOptional() @IsString() @MaxLength(1000)
  rejectionReason?: string;
}

export class SuspendUserDto {
  @ApiProperty({ example: 'Repeated no-shows confirmed across three reports' })
  @IsString() @MinLength(10) @MaxLength(500)
  reason: string;
}

export class UpdateReportDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional() @IsIn(REPORT_STATUSES)
  status?: (typeof REPORT_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Assign to an admin' })
  @IsOptional() @IsUUID()
  assignedAdminId?: string;

  @ApiPropertyOptional({ description: 'Outcome shown to the reporter' })
  @IsOptional() @IsString() @MaxLength(1000)
  resolution?: string;

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsOptional() @IsString() @MaxLength(2000)
  resolutionNotes?: string;
}

export class ResolveDisputeDto {
  @ApiProperty({
    enum: ['RESOLVED', 'DISMISSED'],
    description: 'RESOLVED closes it in the raiser favour path; DISMISSED closes it without action.',
  })
  @IsIn(['RESOLVED', 'DISMISSED'])
  status: 'RESOLVED' | 'DISMISSED';

  @ApiProperty({ example: 'Artisan agreed to return and finish the tiling on Saturday.' })
  @IsString() @MinLength(10) @MaxLength(1000)
  resolution: string;

  @ApiPropertyOptional({
    enum: ['COMPLETED', 'CANCELLED', 'IN_PROGRESS'],
    description: 'Where the job should land once the dispute closes.',
  })
  @IsOptional() @IsIn(['COMPLETED', 'CANCELLED', 'IN_PROGRESS'])
  jobOutcome?: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateAdminDto {
  @ApiProperty({ format: 'uuid', description: 'Existing Deevi user to promote' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: ADMIN_ROLES })
  @IsIn(ADMIN_ROLES)
  adminRole: (typeof ADMIN_ROLES)[number];
}

export class HideReviewDto {
  @ApiProperty({ example: 'Contains personal contact details' })
  @IsString() @MinLength(5) @MaxLength(500)
  reason: string;
}
