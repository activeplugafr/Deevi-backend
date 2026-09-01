import { Global, Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { LocationsService } from './locations.service.js';

@Global()
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, LocationsService],
  exports: [CustomersService, LocationsService],
})
export class CustomersModule {}
