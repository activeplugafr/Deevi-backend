import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller.js';
import { JobApplicationsController } from './job-applications.controller.js';
import { ApplicationsService } from './applications.service.js';

@Module({
  controllers: [ApplicationsController, JobApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
