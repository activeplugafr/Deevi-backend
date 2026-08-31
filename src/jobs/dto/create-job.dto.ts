import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ServiceLocationDto } from '../../common/dto/location.dto.js';

export const URGENCY_LEVELS = ['LOW', 'NORMAL', 'HIGH', 'EMERGENCY'] as const;
export const BUDGET_TYPES = ['FIXED', 'HOURLY', 'DAILY', 'NEGOTIABLE'] as const;

export class JobMediaInputDto {
  @ApiProperty({ description: 'Storage path from POST /storage/upload-ticket (job-media bucket)' })
  @IsString() @IsNotEmpty() @MaxLength(400)
  storagePath: string;

  @ApiPropertyOptional({ enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' })
  @IsOptional() @IsIn(['IMAGE', 'VIDEO'])
  mediaType?: 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) mimeType?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
}

export class CreateJobPostDto {
  @ApiProperty({ example: 'Kitchen sink has been leaking for two days' })
  @IsString() @MinLength(5) @MaxLength(160)
  title: string;

  @ApiProperty({
    example:
      'The pipe under my kitchen sink drips constantly and the cabinet floor is now soaked. ' +
      'I need someone who can come this week and replace the joint.',
    description:
      'The customer own words. Artisans see exactly this text -- it is never replaced with an internal summary.',
  })
  @IsString() @MinLength(20) @MaxLength(5000)
  description: string;

  @ApiProperty({ format: 'uuid', description: 'From GET /catalogue/services' })
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'From GET /catalogue/services/{id}/sub-services' })
  @IsOptional() @IsUUID()
  subServiceId?: string;

  @ApiProperty({
    type: ServiceLocationDto,
    description:
      'Where the work happens. This is the job own location, independent of the customer profile address: ' +
      'someone living in Igando can absolutely request a service in Obalende. Supply a savedLocationId, ' +
      'or an address/city, or coordinates from the map picker or device GPS.',
  })
  @ValidateNested() @Type(() => ServiceLocationDto)
  location: ServiceLocationDto;

  @ApiPropertyOptional({ enum: URGENCY_LEVELS, default: 'NORMAL' })
  @IsOptional() @IsIn(URGENCY_LEVELS)
  urgency?: (typeof URGENCY_LEVELS)[number];

  @ApiPropertyOptional({ example: 15000, description: 'In NGN' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({ example: 40000 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  budgetMax?: number;

  @ApiPropertyOptional({ enum: BUDGET_TYPES, default: 'NEGOTIABLE' })
  @IsOptional() @IsIn(BUDGET_TYPES)
  budgetType?: (typeof BUDGET_TYPES)[number];

  @ApiPropertyOptional({ format: 'date-time', description: 'When the customer would like work to start' })
  @IsOptional() @IsDateString()
  preferredStartAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional() @IsDateString()
  preferredEndAt?: string;

  @ApiPropertyOptional({ example: 'Weekday mornings work best, or Saturday any time' })
  @IsOptional() @IsString() @MaxLength(500)
  preferredTimeNotes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isFlexibleTiming?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) additionalNotes?: string;

  @ApiPropertyOptional({ type: [JobMediaInputDto], description: 'Photos or video of the problem' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => JobMediaInputDto)
  media?: JobMediaInputDto[];

  @ApiPropertyOptional({
    default: true,
    description: 'Publish immediately. Set false to save a DRAFT and publish later.',
  })
  @IsOptional() @IsBoolean()
  publish?: boolean;

  @ApiPropertyOptional({ example: 30, description: 'Days until the post expires. Defaults to 30.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  expiresInDays?: number;
}
