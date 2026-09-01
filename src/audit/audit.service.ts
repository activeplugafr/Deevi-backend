import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { type Paginated } from '../common/dto/pagination.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only trail of privileged actions. Every admin mutation records one
 * of these; nothing here is ever updated or deleted through the API.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async record(actor: AuthUser | null, entry: AuditEntry): Promise<void> {
    try {
      await this.db.from('audit_logs').insert({
        actor_user_id: actor?.id ?? null,
        actor_role: actor?.roles?.[0] ?? null,
        actor_admin_role: actor?.adminRole ?? null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        summary: entry.summary ?? null,
        before_state: entry.before ?? null,
        after_state: entry.after ?? null,
        metadata: entry.metadata ?? {},
        ip_address: entry.ipAddress ?? null,
        user_agent: entry.userAgent ?? null,
      });
    } catch (err) {
      // Losing an audit row must not roll back the action it describes, but
      // it is a genuine operational problem, so log it loudly.
      this.logger.error(`AUDIT WRITE FAILED for ${entry.action}: ${(err as Error).message}`);
    }
  }

  async list(options: {
    page: number;
    limit: number;
    actorId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
  }): Promise<Paginated<any>> {
    let query = this.db
      .select(
        'audit_logs',
        'id, actor_user_id, actor_role, actor_admin_role, action, entity_type, entity_id, summary, metadata, ip_address, created_at',
      )
      .order('created_at', { ascending: false });

    if (options.actorId) query = query.eq('actor_user_id', options.actorId);
    if (options.entityType) query = query.eq('entity_type', options.entityType);
    if (options.entityId) query = query.eq('entity_id', options.entityId);
    if (options.action) query = query.eq('action', options.action);

    return this.db.paginate(query, options.page, options.limit, 'audit:list');
  }
}
