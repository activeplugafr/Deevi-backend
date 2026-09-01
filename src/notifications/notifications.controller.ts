import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsReadService } from './notifications.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import {
  ListNotificationsQueryDto, NotificationDto, NotificationPreferencesDto,
  PushTokenDto, UnreadCountDto, UpdateNotificationPreferencesDto,
} from './dto/notification.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsReadService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications', description: 'Newest first, paginated.' })
  @ApiPaginatedResponse(NotificationDto)
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user.id, {
      page: query.page,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
      type: query.type,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count my unread notifications' })
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  @ApiOkResponse({ type: MessageResponseDto })
  async markAllRead(@CurrentUser() user: AuthUser): Promise<MessageResponseDto> {
    const count = await this.notifications.markAllRead(user.id);
    return { message: `${count} notification(s) marked as read` };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiOkResponse({ type: MessageResponseDto })
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.notifications.markRead(user.id, id);
    return { message: 'Notification marked as read' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a notification' })
  @ApiOkResponse({ type: MessageResponseDto })
  async archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.notifications.archive(user.id, id);
    return { message: 'Notification archived' };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get my notification preferences' })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update my notification preferences' })
  @ApiOkResponse({ type: NotificationPreferencesDto })
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    const values: Record<string, unknown> = {};
    if (dto.inAppEnabled !== undefined) values.in_app_enabled = dto.inAppEnabled;
    if (dto.emailEnabled !== undefined) values.email_enabled = dto.emailEnabled;
    if (dto.pushEnabled !== undefined) values.push_enabled = dto.pushEnabled;
    if (dto.smsEnabled !== undefined) values.sms_enabled = dto.smsEnabled;
    if (dto.mutedTypes !== undefined) values.muted_types = dto.mutedTypes;
    return this.notifications.updatePreferences(user.id, values);
  }

  @Post('push-tokens')
  @ApiOperation({ summary: 'Register a device push token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async registerToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: PushTokenDto,
  ): Promise<MessageResponseDto> {
    await this.notifications.registerPushToken(user.id, dto.token);
    return { message: 'Push token registered' };
  }

  @Delete('push-tokens/:token')
  @ApiOperation({ summary: 'Remove a device push token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async removeToken(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ): Promise<MessageResponseDto> {
    await this.notifications.removePushToken(user.id, token);
    return { message: 'Push token removed' };
  }
}
