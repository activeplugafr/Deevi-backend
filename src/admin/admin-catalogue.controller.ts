import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogueAdminService } from '../catalogue/catalogue-admin.service.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RequireCapability, Roles } from '../common/decorators/roles.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import {
  CatalogueQueryDto, CreateServiceCategoryDto, CreateServiceDto, CreateSubServiceDto,
  ServiceQueryDto, UpdateServiceCategoryDto, UpdateServiceDto, UpdateSubServiceDto,
} from '../catalogue/dto/catalogue.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/catalogue')
export class AdminCatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly catalogueAdmin: CatalogueAdminService,
  ) {}

  @Get('categories')
  @RequireCapability('catalogue:read')
  @ApiOperation({ summary: 'List categories, including inactive ones' })
  listCategories(@Query() query: CatalogueQueryDto) {
    return this.catalogue.listCategories({ ...query, includeInactive: true });
  }

  @Post('categories')
  @RequireCapability('catalogue:write')
  @ApiOperation({
    summary: 'Create a service category',
    description: 'The catalogue is data: nothing in the marketplace branches on a particular slug.',
  })
  createCategory(@CurrentUser() actor: AuthUser, @Body() dto: CreateServiceCategoryDto) {
    return this.catalogueAdmin.createCategory(actor, dto);
  }

  @Patch('categories/:id')
  @RequireCapability('catalogue:write')
  @ApiOperation({ summary: 'Update a category' })
  updateCategory(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
  ) {
    return this.catalogueAdmin.updateCategory(actor, id, dto);
  }

  @Delete('categories/:id')
  @RequireCapability('catalogue:write')
  @ApiOperation({
    summary: 'Retire a category',
    description: 'Refused while it still holds live services, rather than orphaning them.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  deleteCategory(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalogueAdmin.deleteCategory(actor, id);
  }

  @Get('services')
  @RequireCapability('catalogue:read')
  @ApiOperation({ summary: 'List services, including inactive ones' })
  listServices(@Query() query: ServiceQueryDto) {
    return this.catalogue.listServices({ ...query, includeInactive: true });
  }

  @Post('services')
  @RequireCapability('catalogue:write')
  @ApiOperation({ summary: 'Create a service' })
  createService(@CurrentUser() actor: AuthUser, @Body() dto: CreateServiceDto) {
    return this.catalogueAdmin.createService(actor, dto);
  }

  @Patch('services/:id')
  @RequireCapability('catalogue:write')
  @ApiOperation({ summary: 'Update a service' })
  updateService(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.catalogueAdmin.updateService(actor, id, dto);
  }

  @Delete('services/:id')
  @RequireCapability('catalogue:write')
  @ApiOperation({
    summary: 'Retire a service',
    description:
      'Soft delete: open job posts and artisan profiles still reference it. The response reports how ' +
      'many open jobs are affected.',
  })
  deleteService(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalogueAdmin.deleteService(actor, id);
  }

  @Post('sub-services')
  @RequireCapability('catalogue:write')
  @ApiOperation({ summary: 'Create a sub-service' })
  createSubService(@CurrentUser() actor: AuthUser, @Body() dto: CreateSubServiceDto) {
    return this.catalogueAdmin.createSubService(actor, dto);
  }

  @Patch('sub-services/:id')
  @RequireCapability('catalogue:write')
  @ApiOperation({ summary: 'Update a sub-service' })
  updateSubService(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubServiceDto,
  ) {
    return this.catalogueAdmin.updateSubService(actor, id, dto);
  }

  @Delete('sub-services/:id')
  @RequireCapability('catalogue:write')
  @ApiOperation({ summary: 'Retire a sub-service' })
  @ApiOkResponse({ type: MessageResponseDto })
  deleteSubService(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalogueAdmin.deleteSubService(actor, id);
  }
}
