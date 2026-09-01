import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiPropertyOptional({ nullable: true }) email: string | null;
  @ApiPropertyOptional({ nullable: true }) first_name: string | null;
  @ApiPropertyOptional({ nullable: true }) last_name: string | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
  @ApiPropertyOptional({ nullable: true }) avatar_url: string | null;
  @ApiProperty({ example: 'ACTIVE' }) status: string;
  @ApiProperty() email_verified: boolean;
  @ApiProperty({ type: [String], example: ['CUSTOMER'] }) roles: string[];
  @ApiProperty({ format: 'date-time' }) created_at: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Ada' })
  @IsOptional() @IsString() @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Obi' })
  @IsOptional() @IsString() @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Phone number must be 7-15 digits, optionally starting with +' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Storage path returned by POST /storage/upload-ticket (avatars bucket)' })
  @IsOptional() @IsString() @MaxLength(400)
  avatarPath?: string;

  @ApiPropertyOptional({ example: 'en-NG' })
  @IsOptional() @IsString() @MaxLength(10)
  locale?: string;
}

export class DeactivateAccountDto {
  @ApiPropertyOptional({ description: 'Optional reason, stored for support context' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
