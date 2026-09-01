import { Global, Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { CatalogueAdminService } from './catalogue-admin.service.js';

@Global()
@Module({
  controllers: [CatalogueController],
  providers: [CatalogueService, CatalogueAdminService],
  exports: [CatalogueService, CatalogueAdminService],
})
export class CatalogueModule {}
