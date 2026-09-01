import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export const APPLICATION_STATUSES = [
  'SUBMITTED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED',
] as const;
export const PRICE_TYPES = ['FIXED', 'HOURLY', 'DAILY', 'NEGOTIABLE'] as const;
export const DURATION_UNITS = ['MINUTE', 'HOUR', 'DAY', 'WEEK'] as const;

export class CreateApplicationDto {
  @ApiProperty({ format: 'uuid', description: 'The job post I am bidding on' })
  @IsUUID()
  jobPostId: string;

  @ApiProperty({
    example: 'I replaced the same joint on a similar sink last week. I can come Thursday morning.',
    description: 'My pitch to the customer',
  })
  @IsString() @MinLength(20) @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ example: 25000, description: 'My price, in NGN' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  proposedPrice?: number;

  @ApiPropertyOptional({ enum: PRICE_TYPES, default: 'FIXED' })
  @IsOptional() @IsIn(PRICE_TYPES)
  priceType?: (typeof PRICE_TYPES)[number];

  @ApiPropertyOptional({ example: 3, description: 'How long the work will take' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  estimatedDurationValue?: number;

  @ApiPropertyOptional({ enum: DURATION_UNITS })
  @IsOptional() @IsIn(DURATION_UNITS)
  estimatedDurationUnit?: (typeof DURATION_UNITS)[number];

  @ApiPropertyOptional({ example: 'Free weekday mornings and all day Saturday' })
  @IsOptional() @IsString() @MaxLength(500)
  availabilityNote?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Earliest I can start' })
  @IsOptional() @IsDateString()
  canStartAt?: string;

  @ApiPropertyOptional({ example: '8 years on residential plumbing across Lagos Mainland' })
  @IsOptional() @IsString() @MaxLength(1000)
  relevantExperience?: string;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(20) @MaxLength(2000) message?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) proposedPrice?: number;
  @ApiPropertyOptional({ enum: PRICE_TYPES }) @IsOptional() @IsIn(PRICE_TYPES) priceType?: (typeof PRICE_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) estimatedDurationValue?: number;
  @ApiPropertyOptional({ enum: DURATION_UNITS }) @IsOptional() @IsIn(DURATION_UNITS) estimatedDurationUnit?: (typeof DURATION_UNITS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) availabilityNote?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() canStartAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) relevantExperience?: string;
}

export class SelectArtisanDto {
  @ApiPropertyOptional({
    example: 25000,
    description: 'Final agreed price. Defaults to the artisan proposed price.',
  })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  agreedPrice?: number;
}

export class RejectApplicationDto {
  @ApiPropertyOptional({ example: 'Going with someone closer to me' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class ApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional() @IsIn(APPLICATION_STATUSES)
  status?: (typeof APPLICATION_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['newest', 'price_asc', 'price_desc', 'rating'], default: 'newest' })
  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc', 'rating'])
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating';
}
