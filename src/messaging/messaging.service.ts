import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StorageBucket } from '../storage/storage.constants.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { DomainException, ForbiddenError, NotFoundError } from '../common/errors/domain.exception.js';
import { type Paginated } from '../common/dto/pagination.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type {
  ConversationsQueryDto, MessagesQueryDto, SendMessageDto, StartConversationDto,
} from './dto/messaging.dto.js';

const CONVERSATION_COLUMNS = [
  'id', 'job_post_id', 'job_application_id', 'customer_id', 'artisan_id', 'artisan_user_id',
  'status', 'last_message_at', 'last_message_preview', 'last_message_sender_id',
  'customer_unread_count', 'artisan_unread_count', 'message_count', 'created_at',
].join(', ');

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, recipient_id, body, message_type, attachment_path, attachment_mime, read_at, created_at';

/**
 * Job-scoped messaging.
 *
 * Every conversation belongs to exactly one (job post, artisan) pair, which
 * makes authorization simple and airtight: you are either the customer who
 * posted the job or the artisan who applied, and nobody else can read a word.
 * Attachments live in a private bucket and are only ever handed out as
 * short-lived signed URLs, minted after that participant check.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The single authorization gate for every messaging operation. */
  private async requireParticipant(user: AuthUser, conversationId: string) {
    const conversation = await this.db.maybeOne<any>(
      'conversations', CONVERSATION_COLUMNS, { id: conversationId },
    );
    if (!conversation) throw new NotFoundError('Conversation');

    const isCustomer = conversation.customer_id === user.id;
    const isArtisan = conversation.artisan_user_id === user.id;

    // Admins are deliberately excluded: reading private negotiations is a
    // moderation action that must go through a report, not a browse.
    if (!isCustomer && !isArtisan) {
      throw new ForbiddenError('You are not part of this conversation', 'NOT_CONVERSATION_PARTICIPANT');
    }
    if (conversation.status === 'BLOCKED') {
      throw new DomainException('CONVERSATION_BLOCKED', 'This conversation has been blocked', HttpStatus.FORBIDDEN);
    }

    return { conversation, isCustomer, isArtisan };
  }

  /**
   * Opens (or returns) the conversation between a customer and an artisan on
   * a job. A conversation only exists where a real marketplace relationship
   * does: the artisan has applied, or has been selected.
   */
  async startConversation(user: AuthUser, dto: StartConversationDto) {
    const post = await this.db.maybeOne<any>(
      'job_posts', 'id, customer_id, title, status, selected_artisan_id, deleted_at', { id: dto.jobPostId },
    );
    if (!post || post.deleted_at) throw new NotFoundError('Job post');

    const isCustomer = post.customer_id === user.id;

    // An artisan opening a thread is always opening their own. Reject a
    // mismatched artisanId outright rather than quietly substituting theirs,
    // so a confused client hears about it instead of writing to the wrong row.
    if (!isCustomer && dto.artisanId && dto.artisanId !== user.artisanProfileId) {
      throw new ForbiddenError('You can only open conversations as yourself');
    }

    const artisanId = isCustomer ? dto.artisanId : user.artisanProfileId;

    if (!artisanId) {
      throw new DomainException(
        'ARTISAN_REQUIRED',
        isCustomer ? 'Specify which artisan you want to message' : 'You need an artisan profile to message a customer',
      );
    }

    const hasApplied = await this.db.count('job_applications', {
      job_post_id: post.id, artisan_id: artisanId,
    });
    if (!hasApplied && post.selected_artisan_id !== artisanId) {
      throw new DomainException(
        'NO_RELATIONSHIP',
        'You can only message about a job once an application exists between you',
        HttpStatus.FORBIDDEN,
      );
    }

    const artisan = await this.db.one<any>('artisan_profiles', 'id, user_id', { id: artisanId }, 'Artisan');

    const existing = await this.db.maybeOne<any>('conversations', CONVERSATION_COLUMNS, {
      job_post_id: post.id, artisan_id: artisanId,
    });

    const conversation = existing ?? await this.db.insertOne('conversations', {
      job_post_id: post.id,
      customer_id: post.customer_id,
      artisan_id: artisanId,
      artisan_user_id: artisan.user_id,
    }, CONVERSATION_COLUMNS);

    if (dto.message) {
      await this.sendMessage(user, conversation.id, { body: dto.message });
      return this.db.one('conversations', CONVERSATION_COLUMNS, { id: conversation.id }, 'Conversation');
    }

    return conversation;
  }

  async listConversations(user: AuthUser, query: ConversationsQueryDto): Promise<Paginated<any>> {
    const isArtisan = Boolean(user.artisanProfileId);

    let builder = this.db
      .select(
        'conversations',
        `${CONVERSATION_COLUMNS}, job_posts(id, title, status, city, service_id)`,
      )
      .or(`customer_id.eq.${user.id}${isArtisan ? `,artisan_user_id.eq.${user.id}` : ''}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (query.unreadOnly === 'true') {
      builder = builder.or(`customer_unread_count.gt.0,artisan_unread_count.gt.0`);
    }

    const result = await this.db.paginate<any>(builder, query.page, query.limit, 'messaging:conversations');

    return {
      ...result,
      items: result.items.map((conversation) => ({
        ...conversation,
        unread_count: conversation.customer_id === user.id
          ? conversation.customer_unread_count
          : conversation.artisan_unread_count,
      })),
    };
  }

  async getConversation(user: AuthUser, conversationId: string) {
    const { conversation, isCustomer } = await this.requireParticipant(user, conversationId);

    const [post, counterparty] = await Promise.all([
      this.db.maybeOne('job_posts', 'id, title, status, city, neighbourhood, service_id', {
        id: conversation.job_post_id,
      }),
      isCustomer
        ? this.db.maybeOne('users', 'id, first_name, last_name, avatar_url', { id: conversation.artisan_user_id })
        : this.db.maybeOne('users', 'id, first_name, last_name, avatar_url', { id: conversation.customer_id }),
    ]);

    return {
      ...conversation,
      unread_count: isCustomer ? conversation.customer_unread_count : conversation.artisan_unread_count,
      jobPost: post,
      counterparty,
    };
  }

  /**
   * Keyset pagination on (created_at desc). Chat histories grow without bound
   * and offset paging drifts as new messages arrive, so the client walks
   * backwards with `before` instead.
   */
  async listMessages(user: AuthUser, conversationId: string, query: MessagesQueryDto) {
    await this.requireParticipant(user, conversationId);

    let builder = this.db
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(query.limit);

    if (query.before) builder = builder.lt('created_at', query.before);

    const { data, error } = await builder;
    if (error) throw error;

    const messages = (data ?? []).reverse();
    const withUrls = await Promise.all(messages.map(async (message: any) => ({
      ...message,
      attachment_url: message.attachment_path
        ? (await this.storage.createSignedDownloadUrl(
            StorageBucket.MESSAGE_ATTACHMENTS, message.attachment_path,
          )).url
        : null,
      attachment_path: undefined,
    })));

    return {
      items: withUrls,
      // Keyset paging cannot know the total cheaply, and a chat UI never
      // needs one; it needs to know whether to keep scrolling.
      hasMore: messages.length === query.limit,
      nextCursor: messages.length ? messages[0].created_at : null,
    };
  }

  async sendMessage(user: AuthUser, conversationId: string, dto: SendMessageDto) {
    const { conversation, isCustomer } = await this.requireParticipant(user, conversationId);

    if (!dto.body && !dto.attachmentPath) {
      throw new DomainException('EMPTY_MESSAGE', 'Send some text or an attachment');
    }
    if (dto.attachmentPath) this.storage.assertOwnership(dto.attachmentPath, user.id);

    const recipientId = isCustomer ? conversation.artisan_user_id : conversation.customer_id;

    const message = await this.db.insertOne('messages', {
      conversation_id: conversationId,
      sender_id: user.id,
      recipient_id: recipientId,
      body: dto.body ?? null,
      message_type: dto.attachmentPath ? 'IMAGE' : 'TEXT',
      attachment_path: dto.attachmentPath ?? null,
      attachment_mime: dto.attachmentMime ?? null,
    }, MESSAGE_COLUMNS);

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: conversation.job_post_id });

    await this.notifications.notify({
      userId: recipientId,
      type: NotificationType.NEW_MESSAGE,
      entityType: 'CONVERSATION',
      entityId: conversationId,
      template: {
        actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Someone',
        messagePreview: dto.body ? dto.body.slice(0, 120) : 'Sent an attachment',
        jobTitle: post?.title,
      },
      data: { conversationId, jobPostId: conversation.job_post_id },
    });

    return {
      ...message,
      attachment_path: undefined,
      attachment_url: dto.attachmentPath
        ? (await this.storage.createSignedDownloadUrl(
            StorageBucket.MESSAGE_ATTACHMENTS, dto.attachmentPath,
          )).url
        : null,
    };
  }

  /** Marks everything addressed to the caller as read, in one statement. */
  async markRead(user: AuthUser, conversationId: string) {
    await this.requireParticipant(user, conversationId);
    const updated = await this.db.rpc<number>('deevi_mark_conversation_read', {
      p_conversation_id: conversationId,
      p_user_id: user.id,
    });
    return { message: `${updated ?? 0} message(s) marked as read`, markedRead: updated ?? 0 };
  }

  async totalUnread(user: AuthUser) {
    const { data } = await this.db
      .from('conversations')
      .select('customer_id, customer_unread_count, artisan_unread_count')
      .or(`customer_id.eq.${user.id}${user.artisanProfileId ? `,artisan_user_id.eq.${user.id}` : ''}`);

    const unread = (data ?? []).reduce((total: number, row: any) =>
      total + (row.customer_id === user.id ? row.customer_unread_count : row.artisan_unread_count), 0);

    return { unread };
  }

  /**
   * Soft-deletes one's own message. The counterparty's copy stays, because
   * silently rewriting a conversation after the fact would undermine both
   * disputes and trust.
   */
  async deleteMessage(user: AuthUser, conversationId: string, messageId: string) {
    await this.requireParticipant(user, conversationId);

    const message = await this.db.maybeOne<any>('messages', 'id, sender_id', {
      id: messageId, conversation_id: conversationId,
    });
    if (!message) throw new NotFoundError('Message');
    if (message.sender_id !== user.id) {
      throw new ForbiddenError('You can only delete your own messages');
    }

    await this.db.from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId);

    return { message: 'Message deleted' };
  }
}
