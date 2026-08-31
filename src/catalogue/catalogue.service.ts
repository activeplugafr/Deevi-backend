import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys, CacheTtl } from '../cache/cache-keys.js';
import { ConflictError, NotFoundError } from '../common/errors/domain.exception.js';
import { type Paginated } from '../common/dto/pagination.dto.js';
import type { CatalogueQueryDto, ServiceQueryDto } from './dto/catalogue.dto.js';

const CATEGORY_COLUMNS = 'id, name, slug, description, icon_url, colour_hex, group_key, sort_order, is_active';
const SERVICE_COLUMNS =
  'id, category_id, name, slug, description, icon_url, typical_price_min, typical_price_max, requires_verification, sort_order, is_active';
const SUB_SERVICE_COLUMNS = 'id, service_id, name, slug, description, sort_order, is_active';

/**
 * The catalogue is data, not code. Nothing in the marketplace branches on a
 * particular slug: admins can rename, reorder, add or retire services and the
 * matching, feed and job flows keep working unchanged.
 *
 * It is read on nearly every screen and changes rarely, so reads are cached
 * and every write invalidates the whole catalogue namespace.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  /* --------------------------- public reads --------------------------- */

  /** Categories with their services, for building pickers in one request. */
  async getTree(): Promise<any[]> {
    return this.cache.wrap(CacheKeys.catalogueTree(), CacheTtl.catalogue, async () => {
      const [categories, services] = await Promise.all([
        this.db.from('service_categories')
          .select(CATEGORY_COLUMNS)
          .is('deleted_at', null).eq('is_active', true)
          .order('sort_order', { ascending: true }),
        this.db.from('services')
          .select(SERVICE_COLUMNS)
          .is('deleted_at', null).eq('is_active', true)
          .order('sort_order', { ascending: true }),
      ]);

      const byCategory = new Map<string, any[]>();
      for (const service of services.data ?? []) {
        const list = byCategory.get(service.category_id) ?? [];
        list.push(service);
        byCategory.set(service.category_id, list);
      }

      return (categories.data ?? []).map((category: any) => ({
        ...category,
        services: byCategory.get(category.id) ?? [],
      }));
    });
  }

  async listCategories(query: CatalogueQueryDto): Promise<Paginated<any>> {
    let builder = this.db.select('service_categories', CATEGORY_COLUMNS).is('deleted_at', null);
    if (!query.includeInactive) builder = builder.eq('is_active', true);
    if (query.group) builder = builder.eq('group_key', query.group);
    if (query.q) builder = builder.ilike('name', `%${query.q}%`);
    builder = builder.order('sort_order', { ascending: true }).order('name', { ascending: true });

    return this.db.paginate(builder, query.page, query.limit, 'catalogue:categories');
  }

  async listServices(query: ServiceQueryDto): Promise<Paginated<any>> {
    let builder = this.db.select('services', SERVICE_COLUMNS).is('deleted_at', null);
    if (!query.includeInactive) builder = builder.eq('is_active', true);
    if (query.categoryId) builder = builder.eq('category_id', query.categoryId);
    if (query.q) builder = builder.ilike('name', `%${query.q}%`);
    builder = builder.order('sort_order', { ascending: true }).order('name', { ascending: true });

    return this.db.paginate(builder, query.page, query.limit, 'catalogue:services');
  }

  async listSubServices(serviceId: string, includeInactive = false): Promise<any[]> {
    let builder = this.db.from('sub_services')
      .select(SUB_SERVICE_COLUMNS)
      .eq('service_id', serviceId)
      .is('deleted_at', null);
    if (!includeInactive) builder = builder.eq('is_active', true);

    const { data } = await builder.order('sort_order', { ascending: true });
    return data ?? [];
  }

  async getCategory(idOrSlug: string): Promise<any> {
    const filters = isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug };
    return this.db.one('service_categories', CATEGORY_COLUMNS, filters, 'Service category');
  }

  async getService(idOrSlug: string): Promise<any> {
    const filters = isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug };
    const service = await this.db.one('services', SERVICE_COLUMNS, filters, 'Service');
    return { ...service, subServices: await this.listSubServices(service.id) };
  }

  /**
   * Resolves and validates a service (and optional sub-service) reference on
   * an inbound job post or artisan profile, returning the owning category so
   * callers can denormalise it for feed queries.
   */
  async resolveServiceReference(serviceId: string, subServiceId?: string | null) {
    const service = await this.db.maybeOne<any>(
      'services', 'id, category_id, name, is_active, requires_verification', { id: serviceId },
    );
    if (!service || !service.is_active) {
      throw new NotFoundError('Service', 'SERVICE_NOT_FOUND');
    }

    if (subServiceId) {
      const sub = await this.db.maybeOne<any>(
        'sub_services', 'id, service_id, is_active', { id: subServiceId },
      );
      if (!sub || !sub.is_active) throw new NotFoundError('Sub-service', 'SUB_SERVICE_NOT_FOUND');
      if (sub.service_id !== serviceId) {
        throw new ConflictError('SUB_SERVICE_MISMATCH', 'That sub-service does not belong to the chosen service');
      }
    }

    return service;
  }
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);

export { isUuid, slugify };
