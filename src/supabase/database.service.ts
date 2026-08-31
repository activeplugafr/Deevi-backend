import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service.js';
import { translateDbError } from '../common/utils/supabase-error.util.js';
import { NotFoundError } from '../common/errors/domain.exception.js';
import { buildPaginationMeta, type Paginated } from '../common/dto/pagination.dto.js';

/**
 * Thin, consistent access layer over PostgREST.
 *
 * Every read goes through here so that error translation, explicit column
 * selection and exact-count pagination are uniform. Callers pass explicit
 * column lists -- `select('*')` is avoided on high-volume paths because
 * payload size matters a great deal on Nigerian mobile networks.
 */
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly supabase: SupabaseService) {}

  get db(): SupabaseClient {
    return this.supabase.getClient();
  }

  from(table: string) {
    return this.db.from(table);
  }

  /** Runs a PL/pgSQL function, translating any raised condition. */
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) translateDbError(error, `rpc:${fn}`);
    return data as T;
  }

  /** Fetches one row, or null when absent. */
  async maybeOne<T = Record<string, any>>(
    table: string,
    columns: string,
    filters: Record<string, unknown>,
  ): Promise<T | null> {
    let query = this.from(table).select(columns);
    for (const [column, value] of Object.entries(filters)) {
      query = value === null ? query.is(column, null) : query.eq(column, value as any);
    }
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) translateDbError(error, `select:${table}`);
    return (data as T) ?? null;
  }

  /** Fetches one row or throws a 404 naming the entity. */
  async one<T = Record<string, any>>(
    table: string,
    columns: string,
    filters: Record<string, unknown>,
    entityName = table,
  ): Promise<T> {
    const row = await this.maybeOne<T>(table, columns, filters);
    if (!row) throw new NotFoundError(entityName);
    return row;
  }

  async insertOne<T = Record<string, any>>(
    table: string,
    values: Record<string, unknown>,
    returning = '*',
  ): Promise<T> {
    const { data, error } = await this.from(table).insert(values).select(returning).single();
    if (error) translateDbError(error, `insert:${table}`);
    return data as T;
  }

  async insertMany<T = Record<string, any>>(
    table: string,
    values: Record<string, unknown>[],
    returning = '*',
  ): Promise<T[]> {
    if (!values.length) return [];
    const { data, error } = await this.from(table).insert(values).select(returning);
    if (error) translateDbError(error, `insertMany:${table}`);
    return (data ?? []) as T[];
  }

  async updateOne<T = Record<string, any>>(
    table: string,
    filters: Record<string, unknown>,
    values: Record<string, unknown>,
    returning = '*',
    entityName = table,
  ): Promise<T> {
    let query = this.from(table).update(values);
    for (const [column, value] of Object.entries(filters)) {
      query = value === null ? query.is(column, null) : query.eq(column, value as any);
    }
    const { data, error } = await query.select(returning).maybeSingle();
    if (error) translateDbError(error, `update:${table}`);
    if (!data) throw new NotFoundError(entityName);
    return data as T;
  }

  /**
   * Conditional update used as an optimistic lock: the filter includes the
   * status we believe the row is in, so a concurrent transition loses
   * instead of silently overwriting. Returns null when the guard failed.
   */
  async updateIf<T = Record<string, any>>(
    table: string,
    filters: Record<string, unknown>,
    values: Record<string, unknown>,
    returning = '*',
  ): Promise<T | null> {
    let query = this.from(table).update(values);
    for (const [column, value] of Object.entries(filters)) {
      query = Array.isArray(value)
        ? query.in(column, value)
        : value === null
          ? query.is(column, null)
          : query.eq(column, value as any);
    }
    const { data, error } = await query.select(returning).maybeSingle();
    if (error) translateDbError(error, `updateIf:${table}`);
    return (data as T) ?? null;
  }

  async count(table: string, filters: Record<string, unknown> = {}): Promise<number> {
    let query = this.from(table).select('id', { count: 'exact', head: true });
    for (const [column, value] of Object.entries(filters)) {
      query = value === null ? query.is(column, null) : query.eq(column, value as any);
    }
    const { count, error } = await query;
    if (error) translateDbError(error, `count:${table}`);
    return count ?? 0;
  }

  /**
   * Executes a prepared PostgREST query with exact counting and returns the
   * standard `{ items, meta }` envelope.
   */
  async paginate<T = Record<string, any>>(
    query: any,
    page: number,
    limit: number,
    context = 'paginate',
  ): Promise<Paginated<T>> {
    const from = (page - 1) * limit;
    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) translateDbError(error, context);
    return {
      items: (data ?? []) as T[],
      meta: buildPaginationMeta(page, limit, count ?? 0),
    };
  }

  /** Convenience for `select(..., { count: 'exact' })` list endpoints. */
  select(table: string, columns: string) {
    return this.from(table).select(columns, { count: 'exact' });
  }
}
