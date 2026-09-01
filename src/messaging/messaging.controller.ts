import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessagingService } from './messaging.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import {
  ConversationDto, ConversationsQueryDto, MessageDto, MessagesQueryDto,
  SendMessageDto, StartConversationDto,
} from './dto/messaging.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  @ApiOperation({
    summary: 'Open a conversation',
    description:
      'Scoped to a job post and an artisan. Only available once an application exists between the two ' +
      'parties, so the inbox cannot be used for cold outreach. Returns the existing thread if there is one.',
  })
  @ApiOkResponse({ type: ConversationDto })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartConversationDto) {
    return this.messaging.startConversation(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my conversations', description: 'Most recently active first.' })
  @ApiPaginatedResponse(ConversationDto)
  list(@CurrentUser() user: AuthUser, @Query() query: ConversationsQueryDto) {
    return this.messaging.listConversations(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Total unread messages across all my conversations' })
  unread(@CurrentUser() user: AuthUser) {
    return this.messaging.totalUnread(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one conversation with its job and counterparty' })
  @ApiOkResponse({ type: ConversationDto })
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.getConversation(user, id);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Read a conversation',
    description:
      'Keyset paginated, newest page first: pass `before` with the created_at of the oldest message you ' +
      'hold to walk backwards. Full histories are never loaded by default. Attachments come back as ' +
      'short-lived signed URLs.',
  })
  @ApiOkResponse({ type: [MessageDto] })
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.messaging.listMessages(user, id, query);
  }

  @Post(':id/messages')
  @RateLimit({ limit: 60, windowSeconds: 60, bucket: 'message-send' })
  @ApiOperation({ summary: 'Send a message' })
  @ApiOkResponse({ type: MessageDto })
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messaging.sendMessage(user, id, dto);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark this conversation as read' })
  @ApiOkResponse({ type: MessageResponseDto })
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.markRead(user, id);
  }

  @Delete(':id/messages/:messageId')
  @ApiOperation({ summary: 'Delete one of my messages' })
  @ApiOkResponse({ type: MessageResponseDto })
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.messaging.deleteMessage(user, id, messageId);
  }
}
