import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsHexColor, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, IsUUID, Matches, Min, MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export const CATEGORY_GROUPS = ['HOME_REPAIR', 'PERSONAL', 'MOBILITY', 'GENERAL'] as const;

const SLUG_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ServiceCategoryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Plumbing' }) name: string;
  @ApiProperty({ example: 'plumbing' }) slug: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiPropertyOptional({ nullable: true }) icon_url: string | null;
  @ApiProperty({ enum: CATEGORY_GROUPS }) group_key: string;
  @ApiProperty({ example: 10 }) sort_order: number;
  @ApiProperty() is_active: boolean;
}

export class ServiceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) category_id: string;
  @ApiProperty({ example: 'Leak & Pipe Repair' }) name: string;
  @ApiProperty({ example: 'leak-pipe-repair' }) slug: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) typical_price_min: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) typical_price_max: number | null;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 10 }) sort_order: number;
}

export class SubServiceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) service_id: string;
  @ApiProperty({ example: 'Knotless Braids' }) name: string;
  @ApiProperty({ example: 'knotless-braids' }) slug: string;
  @ApiProperty() is_active: boolean;
  @ApiProperty({ example: 10 }) sort_order: number;
}

export class CatalogueTreeCategoryDto extends ServiceCategoryDto {
  @ApiProperty({ type: [ServiceDto] }) services: ServiceDto[];
}

export class CatalogueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Include inactive entries (admin views)' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ enum: CATEGORY_GROUPS })
  @IsOptional()
  @IsIn(CATEGORY_GROUPS)
  group?: (typeof CATEGORY_GROUPS)[number];

  @ApiPropertyOptional({ description: 'Free-text search on name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class ServiceQueryDto extends CatalogueQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

/* ------------------------------------------------------------------ */
/* Admin write DTOs                                                    */
/* ------------------------------------------------------------------ */

export class CreateServiceCategoryDto {
  @ApiProperty({ example: 'Plumbing' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    example: 'plumbing',
    description: 'URL-safe identifier. Derived from the name when omitted.',
  })
  @IsOptional() @IsString() @MaxLength(140)
  @Matches(SLUG_RULE, { message: 'slug must be lowercase words separated by hyphens' })
  slug?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) iconUrl?: string;
  @ApiPropertyOptional({ example: '#0F62FE' }) @IsOptional() @IsHexColor() colourHex?: string;

  @ApiProperty({ enum: CATEGORY_GROUPS, default: 'GENERAL' })
  @IsOptional() @IsIn(CATEGORY_GROUPS)
  groupKey?: (typeof CATEGORY_GROUPS)[number];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateServiceCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) iconUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsHexColor() colourHex?: string;
  @ApiPropertyOptional({ enum: CATEGORY_GROUPS })
  @IsOptional() @IsIn(CATEGORY_GROUPS) groupKey?: (typeof CATEGORY_GROUPS)[number];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateServiceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId: string;

  @ApiProperty({ example: 'AC Servicing' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: 'Derived from the name when omitted' })
  @IsOptional() @IsString() @MaxLength(140)
  @Matches(SLUG_RULE, { message: 'slug must be lowercase words separated by hyphens' })
  slug?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) iconUrl?: string;

  @ApiPropertyOptional({ description: 'Guide price shown to customers, in NGN' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) typicalPriceMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) typicalPriceMax?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'When true, only artisans with an approved verification may offer this service.',
  })
  @IsOptional() @IsBoolean() requiresVerification?: boolean;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateServiceDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) iconUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) typicalPriceMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) typicalPriceMax?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresVerification?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateSubServiceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() serviceId: string;
  @ApiProperty({ example: 'Gas Top-Up' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(140)
  @Matches(SLUG_RULE, { message: 'slug must be lowercase words separated by hyphens' })
  slug?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSubServiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
