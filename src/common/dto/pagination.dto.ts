import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Every list endpoint in Deevi takes these. Feeds are never unbounded:
 * `limit` is hard-capped so a bad client cannot pull the whole table over a
 * Nigerian mobile connection.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, description: 'Page number, 1-indexed' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, description: 'Items per page (max 100)' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

}

export class SortablePaginationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

export class SearchablePaginationQueryDto extends SortablePaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search term', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 137 }) total: number;
  @ApiProperty({ example: 7 }) totalPages: number;
  @ApiProperty({ example: true }) hasNextPage: boolean;
  @ApiProperty({ example: false }) hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMetaDto;
}

export const buildPaginationMeta = (page: number, limit: number, total: number): PaginationMetaDto => {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
};

export const paginate = <T>(items: T[], page: number, limit: number, total: number): Paginated<T> => ({
  items,
  meta: buildPaginationMeta(page, limit, total),
});

/** PostgREST range is inclusive on both ends. */
export const toRange = (page: number, limit: number): [number, number] => {
  const from = (page - 1) * limit;
  return [from, from + limit - 1];
};


export class AdminApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
    description: 'Filter applications by verification status',
  })
  @IsOptional()
  @IsEnum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'])
  status?: string;
}