import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminCatalogueController } from './admin-catalogue.controller.js';
import { AdminOpsController } from './admin-ops.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminController, AdminCatalogueController, AdminOpsController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
