import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class CreateReviewDto {
  @ApiProperty({ format: 'uuid', description: 'The completed engagement being reviewed' })
  @IsUUID()
  jobId: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating: number;

  @ApiPropertyOptional({ example: 'Turned up on time, fixed the leak properly and cleaned up after.' })
  @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;
}

export class ReviewDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) job_id: string;
  @ApiProperty({ format: 'uuid' }) reviewer_id: string;
  @ApiProperty({ format: 'uuid' }) reviewee_id: string;
  @ApiProperty({ example: 'CUSTOMER_TO_ARTISAN' }) direction: string;
  @ApiProperty({ example: 5 }) rating: number;
  @ApiPropertyOptional({ nullable: true }) comment: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}

export class ArtisanReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Only reviews with this rating' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating?: number;
}

export class ReviewEligibilityDto {
  @ApiProperty({ example: true }) canReview: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'You have already reviewed this job' })
  reason: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) existingReviewId: string | null;
}
