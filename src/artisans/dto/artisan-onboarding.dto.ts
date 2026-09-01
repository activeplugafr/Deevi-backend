import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional,
  IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const DOCUMENT_TYPES = [
  'NIN', 'DRIVERS_LICENCE', 'VOTERS_CARD', 'INTERNATIONAL_PASSPORT', 'CAC_CERTIFICATE',
  'UTILITY_BILL', 'TRADE_CERTIFICATE', 'GUARANTOR_LETTER', 'PROOF_OF_ADDRESS', 'OTHER',
] as const;

export class ServiceAreaInputDto {
  @ApiPropertyOptional({ example: 'Mainland' })
  @IsOptional() @IsString() @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ example: 'Yaba' })
  @IsOptional() @IsString() @MaxLength(120)
  neighbourhood?: string;

  @ApiProperty({ example: 'Lagos Mainland' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  city: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional() @IsString() @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({ example: 6.5095 })
  @IsOptional() @Type(() => Number) @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 3.3711 })
  @IsOptional() @Type(() => Number) @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 12, minimum: 1, maximum: 200, default: 10 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  radiusKm?: number;
}

export class SetServiceAreasDto {
  @ApiProperty({ type: [ServiceAreaInputDto], description: 'Replaces the artisan service areas wholesale.' })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ServiceAreaInputDto)
  areas: ServiceAreaInputDto[];
}

export class AvailabilitySlotDto {
  @ApiProperty({ example: 1, description: '0 = Sunday through 6 = Saturday', minimum: 0, maximum: 6 })
  @Type(() => Number) @IsInt() @Min(0) @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '08:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime: string;
}

export class SetAvailabilityDto {
  @ApiProperty({ type: [AvailabilitySlotDto], description: 'Replaces the weekly availability wholesale.' })
  @IsArray() @ValidateNested({ each: true }) @Type(() => AvailabilitySlotDto)
  slots: AvailabilitySlotDto[];
}

export class AddPortfolioItemDto {
  @ApiProperty({ description: 'Storage path from POST /storage/upload-ticket (portfolio bucket)' })
  @IsString() @IsNotEmpty() @MaxLength(400)
  storagePath: string;

  @ApiPropertyOptional({ example: 'Bathroom refit in Lekki' })
  @IsOptional() @IsString() @MaxLength(160)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;

  @ApiPropertyOptional({ enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' })
  @IsOptional() @IsIn(['IMAGE', 'VIDEO'])
  mediaType?: 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sortOrder?: number;
}

export class AddVerificationDocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType: (typeof DOCUMENT_TYPES)[number];

  @ApiProperty({
    description:
      'Storage path from POST /storage/upload-ticket (verification-documents bucket). This bucket is ' +
      'PRIVATE: the file is only ever readable through a short-lived signed URL issued to the owner or ' +
      'to an admin with the documents:read capability.',
  })
  @IsString() @IsNotEmpty() @MaxLength(400)
  storagePath: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) originalFilename?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) mimeType?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) sizeBytes?: number;
}

export class SubmitApplicationDto {
  @ApiPropertyOptional({ description: 'Anything the verification team should know' })
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
