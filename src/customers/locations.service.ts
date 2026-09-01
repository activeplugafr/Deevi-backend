import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { DomainException, NotFoundError } from '../common/errors/domain.exception.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import type { CreateLocationDto, UpdateLocationDto } from './dto/location.dto.js';

const LOCATION_COLUMNS =
  'id, label, address_line, neighbourhood, city, state, country, latitude, longitude, notes, source, is_default, created_at';

/**
 * Saved locations belong to a user, not to a job.
 *
 * A customer living in Igando may well book a service in Obalende, so saving
 * a location is a convenience for pre-filling a job post -- never an implicit
 * default that overrides what the customer actually typed for the job.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string) {
    const { data } = await this.db
      .from('locations')
      .select(LOCATION_COLUMNS)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async get(userId: string, id: string) {
    const location = await this.db.maybeOne('locations', LOCATION_COLUMNS, {
      id, user_id: userId, deleted_at: null,
    });
    if (!location) throw new NotFoundError('Location');
    return location;
  }

  async create(userId: string, dto: CreateLocationDto) {
    if (!dto.city && (dto.latitude === undefined || dto.longitude === undefined)) {
      throw new DomainException(
        'LOCATION_NOT_RESOLVABLE',
        'Provide at least a city, or latitude and longitude',
      );
    }

    if (dto.isDefault) await this.clearDefault(userId);

    return this.db.insertOne('locations', {
      user_id: userId,
      label: dto.label,
      address_line: dto.addressLine ?? null,
      neighbourhood: dto.neighbourhood ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      country: dto.country ?? 'NG',
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      notes: dto.notes ?? null,
      source: dto.source ?? 'MANUAL',
      is_default: dto.isDefault ?? false,
    }, LOCATION_COLUMNS);
  }

  async update(userId: string, id: string, dto: UpdateLocationDto) {
    await this.get(userId, id);
    if (dto.isDefault) await this.clearDefault(userId);

    return this.db.updateOne('locations', { id, user_id: userId }, compact({
      label: dto.label,
      address_line: dto.addressLine,
      neighbourhood: dto.neighbourhood,
      city: dto.city,
      state: dto.state,
      latitude: dto.latitude,
      longitude: dto.longitude,
      notes: dto.notes,
      is_default: dto.isDefault,
    }), LOCATION_COLUMNS, 'Location');
  }

  /**
   * Soft delete: past job posts reference the saved location they were
   * created from, and those references must not dangle.
   */
  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.db.updateOne('locations', { id, user_id: userId },
      { deleted_at: new Date().toISOString(), is_default: false }, 'id', 'Location');
    return { message: 'Location removed' };
  }

  private async clearDefault(userId: string): Promise<void> {
    await this.db.from('locations')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('is_default', true);
  }
}
