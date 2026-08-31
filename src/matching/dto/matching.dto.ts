import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class RecommendArtisansQueryDto extends PaginationQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The service the customer needs' })
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  subServiceId?: string;

  @ApiPropertyOptional({ example: 6.4474, description: 'Where the work is. Improves ranking considerably.' })
  @IsOptional() @Type(() => Number) @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 3.4064 })
  @IsOptional() @Type(() => Number) @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Obalende', description: 'Used when coordinates are not available' })
  @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5, description: 'Only artisans at or above this rating' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(5)
  minRating?: number;
}

export class RecommendForJobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(5)
  minRating?: number;
}

export class RecommendedArtisanDto {
  @ApiProperty({ format: 'uuid' }) artisan_id: string;
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiPropertyOptional({ nullable: true }) first_name: string | null;
  @ApiPropertyOptional({ nullable: true }) last_name: string | null;
  @ApiPropertyOptional({ nullable: true }) avatar_url: string | null;
  @ApiPropertyOptional({ nullable: true }) headline: string | null;
  @ApiPropertyOptional({ nullable: true }) business_name: string | null;
  @ApiPropertyOptional({ nullable: true }) bio: string | null;
  @ApiProperty({ example: 8 }) years_of_experience: number;
  @ApiProperty({ example: 4.7, type: Number }) rating_average: number;
  @ApiProperty({ example: 23 }) rating_count: number;
  @ApiProperty({ example: 41 }) jobs_completed_count: number;
  @ApiProperty({ example: 'AVAILABLE' }) availability_status: string;
  @ApiPropertyOptional({ nullable: true }) base_city: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Km from the job location' })
  distance_km: number | null;
  @ApiProperty({ example: false }) is_premium: boolean;
  @ApiProperty({ example: 72.4, type: Number, description: 'Deterministic match score used for ordering' })
  match_score: number;
}

export class InviteArtisanDto {
  @ApiProperty({ format: 'uuid', description: 'The job post to invite them to' })
  @IsUUID()
  jobPostId: string;

  @ApiPropertyOptional({ example: 'Saw your profile, would you be able to take this on?' })
  @IsOptional() @IsString() @MaxLength(1000)
  message?: string;
}
