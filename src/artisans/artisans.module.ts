import { Global, Module } from '@nestjs/common';
import { ArtisansController } from './artisans.controller.js';
import { ArtisansService } from './artisans.service.js';

@Global()
@Module({
  controllers: [ArtisansController],
  providers: [ArtisansService],
  exports: [ArtisansService],
})
export class ArtisansModule {}
