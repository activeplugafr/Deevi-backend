import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CatalogueService } from './catalogue.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import {
  CatalogueQueryDto, CatalogueTreeCategoryDto, ServiceCategoryDto,
  ServiceDto, ServiceQueryDto, SubServiceDto,
} from './dto/catalogue.dto.js';

@ApiTags('Catalogue')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Public()
  @Get('tree')
  @ApiOperation({
    summary: 'Get the whole catalogue in one call',
    description:
      'Active categories with their active services, ready to render a picker. Cached for 5 minutes ' +
      'and invalidated whenever an admin edits the catalogue.',
  })
  @ApiOkResponse({ type: [CatalogueTreeCategoryDto] })
  tree() {
    return this.catalogue.getTree();
  }

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'List service categories' })
  @ApiPaginatedResponse(ServiceCategoryDto)
  listCategories(@Query() query: CatalogueQueryDto) {
    return this.catalogue.listCategories(query);
  }

  @Public()
  @Get('categories/:idOrSlug')
  @ApiOperation({ summary: 'Get one category by id or slug' })
  @ApiParam({ name: 'idOrSlug', example: 'plumbing' })
  @ApiOkResponse({ type: ServiceCategoryDto })
  getCategory(@Param('idOrSlug') idOrSlug: string) {
    return this.catalogue.getCategory(idOrSlug);
  }

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'List services, optionally filtered by category' })
  @ApiPaginatedResponse(ServiceDto)
  listServices(@Query() query: ServiceQueryDto) {
    return this.catalogue.listServices(query);
  }

  @Public()
  @Get('services/:idOrSlug')
  @ApiOperation({ summary: 'Get one service with its sub-services' })
  @ApiParam({ name: 'idOrSlug', example: 'ac-servicing' })
  @ApiOkResponse({ type: ServiceDto })
  getService(@Param('idOrSlug') idOrSlug: string) {
    return this.catalogue.getService(idOrSlug);
  }

  @Public()
  @Get('services/:serviceId/sub-services')
  @ApiOperation({ summary: 'List the sub-services of a service' })
  @ApiOkResponse({ type: [SubServiceDto] })
  listSubServices(@Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.catalogue.listSubServices(serviceId);
  }
}
