import { Module } from '@nestjs/common';
import { ArtisansService } from './artisans.service.js';

@Module({
  providers: [ArtisansService]
})
export class ArtisansModule {}
