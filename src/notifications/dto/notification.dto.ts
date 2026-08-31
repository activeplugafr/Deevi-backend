import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'APPLICATION_RECEIVED' }) type: string;
  @ApiProperty({ example: 'New application received' }) title: string;
  @ApiPropertyOptional({ nullable: true }) body: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) data: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true, example: 'JOB_POST' }) entity_type: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) entity_id: string | null;
  @ApiProperty({ example: 'NORMAL' }) priority: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) read_at: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only return unread notifications' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ description: 'Filter by notification type' })
  @IsOptional()
  @IsString()
  type?: string;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 }) unread: number;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inAppEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pushEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() smsEnabled?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Notification types to suppress entirely' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mutedTypes?: string[];
}

export class NotificationPreferencesDto {
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiProperty() in_app_enabled: boolean;
  @ApiProperty() email_enabled: boolean;
  @ApiProperty() push_enabled: boolean;
  @ApiProperty() sms_enabled: boolean;
  @ApiProperty({ type: [String] }) muted_types: string[];
}

export class PushTokenDto {
  @ApiProperty({ description: 'Device push token', maxLength: 512 })
  @IsString()
  @MaxLength(512)
  token: string;
}
