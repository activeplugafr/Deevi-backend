import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export class StartConversationDto {
  @ApiProperty({ format: 'uuid', description: 'The job post the conversation is about' })
  @IsUUID()
  jobPostId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The artisan to talk to. Customers must supply this; artisans are inferred from their own account.',
  })
  @IsOptional() @IsUUID()
  artisanId?: string;

  @ApiPropertyOptional({ description: 'Optional first message' })
  @IsOptional() @IsString() @MaxLength(4000)
  message?: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'Can you come on Saturday morning?', maxLength: 4000 })
  @ValidateIf((dto) => !dto.attachmentPath)
  @IsString() @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({
    description:
      'Storage path from POST /storage/upload-ticket (message-attachments bucket). That bucket is ' +
      'private: recipients fetch the file through a signed URL.',
  })
  @IsOptional() @IsString() @MaxLength(400)
  attachmentPath?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) attachmentMime?: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  limit: number = 30;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Keyset cursor: return messages older than this timestamp. Use the created_at of the oldest ' +
      'message you already have. Preferred over page numbers for chat history.',
  })
  @IsOptional() @IsDateString()
  before?: string;
}

export class ConversationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only conversations with unread messages' })
  @IsOptional() @IsIn(['true', 'false'])
  unreadOnly?: string;
}

export class ConversationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) job_post_id: string;
  @ApiProperty({ format: 'uuid' }) customer_id: string;
  @ApiProperty({ format: 'uuid' }) artisan_id: string;
  @ApiProperty({ example: 'ACTIVE' }) status: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) last_message_at: string | null;
  @ApiPropertyOptional({ nullable: true }) last_message_preview: string | null;
  @ApiProperty({ example: 2, description: 'Unread count for the calling user' }) unread_count: number;
  @ApiProperty({ example: 14 }) message_count: number;
}

export class MessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) conversation_id: string;
  @ApiProperty({ format: 'uuid' }) sender_id: string;
  @ApiPropertyOptional({ nullable: true }) body: string | null;
  @ApiProperty({ example: 'TEXT' }) message_type: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Short-lived signed URL, present only when the message carries an attachment',
  })
  attachment_url: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) read_at: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
}
