import { Global, Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { LocationsService } from './locations.service.js';
import { ArtisansService } from './artisans/artisans.service.js';

@Global()
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, LocationsService, ArtisansService],
  exports: [CustomersService, LocationsService],
})
export class CustomersModule {}
