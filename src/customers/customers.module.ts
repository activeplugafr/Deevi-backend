import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service.js';

@Module({
  providers: [CustomersService]
})
export class CustomersModule {}
