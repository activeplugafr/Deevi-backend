import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PaginationQueryDto, buildPaginationMeta, toRange } from './pagination.dto.js';

const parse = (query: Record<string, unknown>) => {
  const dto = plainToInstance(PaginationQueryDto, query);
  return { dto, errors: validateSync(dto) };
};

describe('pagination bounds', () => {
  it('defaults to page 1 with 20 items', () => {
    const { dto, errors } = parse({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('caps the page size so a feed can never be pulled unbounded', () => {
    const { errors } = parse({ page: '1', limit: '5000' });
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toMatch(/max/i);
  });

  it('rejects a zero or negative page', () => {
    expect(parse({ page: '0' }).errors.length).toBeGreaterThan(0);
    expect(parse({ page: '-3' }).errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-numeric limit', () => {
    expect(parse({ limit: 'all' }).errors.length).toBeGreaterThan(0);
  });

  it('accepts the maximum page size exactly', () => {
    const { dto, errors } = parse({ limit: '100' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(100);
  });
});

describe('pagination metadata', () => {
  it('computes pages and flags for a middle page', () => {
    expect(buildPaginationMeta(2, 20, 137)).toEqual({
      page: 2, limit: 20, total: 137, totalPages: 7,
      hasNextPage: true, hasPreviousPage: true,
    });
  });

  it('flags the last page correctly', () => {
    const meta = buildPaginationMeta(7, 20, 137);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('reports no pages for an empty result', () => {
    expect(buildPaginationMeta(1, 20, 0)).toMatchObject({
      totalPages: 0, hasNextPage: false, hasPreviousPage: false,
    });
  });

  it('handles a total that fits in exactly one page', () => {
    expect(buildPaginationMeta(1, 20, 20)).toMatchObject({
      totalPages: 1, hasNextPage: false, hasPreviousPage: false,
    });
  });
});

describe('PostgREST ranges', () => {
  it('produces inclusive ranges', () => {
    expect(toRange(1, 20)).toEqual([0, 19]);
    expect(toRange(3, 10)).toEqual([20, 29]);
  });
});
