import { Global, Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { EngagementsController } from './engagements.controller.js';
import { JobsService } from './jobs.service.js';

@Global()
@Module({
  controllers: [JobsController, EngagementsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
