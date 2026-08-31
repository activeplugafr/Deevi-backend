import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys } from '../cache/cache-keys.js';
import { AuditService } from '../audit/audit.service.js';
import { ConflictError } from '../common/errors/domain.exception.js';
import { slugify } from './catalogue.service.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type {
  CreateServiceCategoryDto, CreateServiceDto, CreateSubServiceDto,
  UpdateServiceCategoryDto, UpdateServiceDto, UpdateSubServiceDto,
} from './dto/catalogue.dto.js';

/** Drops undefined keys so a PATCH only touches the fields it was given. */
export const compact = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

/**
 * Catalogue mutation. Every write is audited and invalidates the catalogue
 * cache namespace, which is why that invalidation lives next to the writes
 * rather than being sprinkled around the codebase.
 */
@Injectable()
export class CatalogueAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.delByPrefix(CacheKeys.catalogueNamespace);
  }

  private async assertSlugFree(table: string, slug: string): Promise<void> {
    const existing = await this.db.maybeOne(table, 'id', { slug, deleted_at: null });
    if (existing) throw new ConflictError('SLUG_TAKEN', `"${slug}" is already in use`);
  }

  /* ---------------------------- categories ---------------------------- */

  async createCategory(actor: AuthUser, dto: CreateServiceCategoryDto) {
    const slug = dto.slug ?? slugify(dto.name);
    await this.assertSlugFree('service_categories', slug);

    const category = await this.db.insertOne('service_categories', {
      name: dto.name,
      slug,
      description: dto.description ?? null,
      icon_url: dto.iconUrl ?? null,
      colour_hex: dto.colourHex ?? null,
      group_key: dto.groupKey ?? 'GENERAL',
      sort_order: dto.sortOrder ?? 0,
      is_active: dto.isActive ?? true,
    });

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_CATEGORY_CREATED',
      entityType: 'SERVICE_CATEGORY',
      entityId: category.id,
      summary: `Created category "${category.name}"`,
      after: category,
    });
    return category;
  }

  async updateCategory(actor: AuthUser, id: string, dto: UpdateServiceCategoryDto) {
    const before = await this.db.one('service_categories', '*', { id }, 'Service category');

    const after = await this.db.updateOne('service_categories', { id }, compact({
      name: dto.name,
      description: dto.description,
      icon_url: dto.iconUrl,
      colour_hex: dto.colourHex,
      group_key: dto.groupKey,
      sort_order: dto.sortOrder,
      is_active: dto.isActive,
    }), '*', 'Service category');

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_CATEGORY_UPDATED',
      entityType: 'SERVICE_CATEGORY',
      entityId: id,
      summary: `Updated category "${after.name}"`,
      before, after,
    });
    return after;
  }

  /**
   * Soft delete. A category with live services stays put: silently orphaning
   * services would break every job post that references them.
   */
  async deleteCategory(actor: AuthUser, id: string) {
    const category = await this.db.one('service_categories', 'id, name', { id }, 'Service category');

    const activeServices = await this.db.count('services', { category_id: id, deleted_at: null });
    if (activeServices > 0) {
      throw new ConflictError(
        'CATEGORY_HAS_SERVICES',
        `This category still has ${activeServices} service(s). Move or retire them first.`,
      );
    }

    await this.db.updateOne('service_categories', { id },
      { deleted_at: new Date().toISOString(), is_active: false }, 'id', 'Service category');

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_CATEGORY_DELETED',
      entityType: 'SERVICE_CATEGORY',
      entityId: id,
      summary: `Retired category "${category.name}"`,
    });
    return { message: 'Category retired' };
  }

  /* ----------------------------- services ----------------------------- */

  async createService(actor: AuthUser, dto: CreateServiceDto) {
    await this.db.one('service_categories', 'id', { id: dto.categoryId }, 'Service category');
    const slug = dto.slug ?? slugify(dto.name);
    await this.assertSlugFree('services', slug);

    const service = await this.db.insertOne('services', {
      category_id: dto.categoryId,
      name: dto.name,
      slug,
      description: dto.description ?? null,
      icon_url: dto.iconUrl ?? null,
      typical_price_min: dto.typicalPriceMin ?? null,
      typical_price_max: dto.typicalPriceMax ?? null,
      requires_verification: dto.requiresVerification ?? false,
      sort_order: dto.sortOrder ?? 0,
      is_active: dto.isActive ?? true,
    });

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_SERVICE_CREATED',
      entityType: 'SERVICE',
      entityId: service.id,
      summary: `Created service "${service.name}"`,
      after: service,
    });
    return service;
  }

  async updateService(actor: AuthUser, id: string, dto: UpdateServiceDto) {
    const before = await this.db.one('services', '*', { id }, 'Service');
    if (dto.categoryId) {
      await this.db.one('service_categories', 'id', { id: dto.categoryId }, 'Service category');
    }

    const after = await this.db.updateOne('services', { id }, compact({
      category_id: dto.categoryId,
      name: dto.name,
      description: dto.description,
      icon_url: dto.iconUrl,
      typical_price_min: dto.typicalPriceMin,
      typical_price_max: dto.typicalPriceMax,
      requires_verification: dto.requiresVerification,
      sort_order: dto.sortOrder,
      is_active: dto.isActive,
    }), '*', 'Service');

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_SERVICE_UPDATED',
      entityType: 'SERVICE',
      entityId: id,
      summary: `Updated service "${after.name}"`,
      before, after,
    });
    return after;
  }

  /**
   * Services are never hard-deleted: open job posts and artisan profiles point
   * at them. Retiring hides the service from pickers while history stays intact.
   */
  async deleteService(actor: AuthUser, id: string) {
    const service = await this.db.one('services', 'id, name', { id }, 'Service');

    const openJobs = await this.db
      .from('job_posts')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', id)
      .in('status', ['PUBLISHED', 'RECEIVING_APPLICATIONS', 'ARTISAN_SELECTED', 'ACCEPTED', 'IN_PROGRESS']);

    await this.db.updateOne('services', { id },
      { deleted_at: new Date().toISOString(), is_active: false }, 'id', 'Service');

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_SERVICE_DELETED',
      entityType: 'SERVICE',
      entityId: id,
      summary: `Retired service "${service.name}"`,
      metadata: { openJobsAtRetirement: openJobs.count ?? 0 },
    });
    return { message: 'Service retired', openJobsStillReferencingIt: openJobs.count ?? 0 };
  }

  /* --------------------------- sub-services --------------------------- */

  async createSubService(actor: AuthUser, dto: CreateSubServiceDto) {
    await this.db.one('services', 'id', { id: dto.serviceId }, 'Service');
    const slug = dto.slug ?? slugify(dto.name);

    const existing = await this.db.maybeOne('sub_services', 'id', {
      service_id: dto.serviceId, slug, deleted_at: null,
    });
    if (existing) throw new ConflictError('SLUG_TAKEN', `"${slug}" already exists on this service`);

    const sub = await this.db.insertOne('sub_services', {
      service_id: dto.serviceId,
      name: dto.name,
      slug,
      description: dto.description ?? null,
      sort_order: dto.sortOrder ?? 0,
      is_active: dto.isActive ?? true,
    });

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_SUB_SERVICE_CREATED',
      entityType: 'SUB_SERVICE',
      entityId: sub.id,
      summary: `Created sub-service "${sub.name}"`,
    });
    return sub;
  }

  async updateSubService(actor: AuthUser, id: string, dto: UpdateSubServiceDto) {
    const before = await this.db.one('sub_services', '*', { id }, 'Sub-service');
    const after = await this.db.updateOne('sub_services', { id }, compact({
      name: dto.name,
      description: dto.description,
      sort_order: dto.sortOrder,
      is_active: dto.isActive,
    }), '*', 'Sub-service');

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_SUB_SERVICE_UPDATED',
      entityType: 'SUB_SERVICE',
      entityId: id,
      before, after,
    });
    return after;
  }

  async deleteSubService(actor: AuthUser, id: string) {
    await this.db.one('sub_services', 'id', { id }, 'Sub-service');
    await this.db.updateOne('sub_services', { id },
      { deleted_at: new Date().toISOString(), is_active: false }, 'id', 'Sub-service');

    await this.invalidate();
    await this.audit.record(actor, {
      action: 'CATALOGUE_SUB_SERVICE_DELETED',
      entityType: 'SUB_SERVICE',
      entityId: id,
    });
    return { message: 'Sub-service retired' };
  }
}
