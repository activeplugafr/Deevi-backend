import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';
import { DatabaseService } from './database.service.js';

@Global()
@Module({
  providers: [SupabaseService, DatabaseService],
  exports: [SupabaseService, DatabaseService],
})
export class SupabaseModule {}
