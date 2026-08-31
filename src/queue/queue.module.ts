import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { QueueWorker } from './queue.worker.js';
import { MaintenanceHandlers } from './maintenance.handlers.js';

@Global()
@Module({
  providers: [QueueService, QueueWorker, MaintenanceHandlers],
  exports: [QueueService],
})
export class QueueModule {}
