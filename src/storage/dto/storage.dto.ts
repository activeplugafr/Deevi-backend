import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { StorageBucket } from '../storage.constants.js';

const UPLOADABLE_BUCKETS = [
  StorageBucket.AVATARS,
  StorageBucket.PORTFOLIO,
  StorageBucket.JOB_MEDIA,
  StorageBucket.MESSAGE_ATTACHMENTS,
  StorageBucket.VERIFICATION_DOCUMENTS,
] as const;

export class CreateUploadTicketDto {
  @ApiProperty({
    enum: UPLOADABLE_BUCKETS,
    description:
      'Target bucket. verification-documents and message-attachments are private and only readable via a signed URL.',
  })
  @IsIn(UPLOADABLE_BUCKETS as unknown as string[])
  bucket: StorageBucket;

  @ApiProperty({ example: 'kitchen-leak.jpg' })
  @IsString()
  @MaxLength(200)
  filename: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  mimeType: string;

  @ApiPropertyOptional({ description: 'Size in bytes, validated against the bucket limit' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes?: number;
}

export class UploadTicketDto {
  @ApiProperty({ example: 'job-media' }) bucket: string;
  @ApiProperty({ description: 'Object key to store against the created record' }) path: string;
  @ApiProperty({ description: 'PUT the file bytes here' }) uploadUrl: string;
  @ApiProperty() token: string;
  @ApiPropertyOptional({ nullable: true, description: 'Permanent URL (public buckets only)' })
  publicUrl: string | null;
  @ApiProperty({ example: 300 }) expiresIn: number;
  @ApiProperty({ example: 26214400 }) maxBytes: number;
  @ApiProperty({ type: [String] }) allowedMimeTypes: string[];
}

export class SignedUrlDto {
  @ApiProperty() url: string;
  @ApiProperty({ example: 300 }) expiresIn: number;
}
