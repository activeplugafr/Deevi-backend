import { Module } from '@nestjs/common';
import { BoostsService } from './boosts.service.js';

/**
 * Boosts are DORMANT for the MVP (see src/config/mvp-scope.ts).
 *
 * The domain stays represented -- tables, service, and the bounded ranking
 * multiplier in the feed SQL -- but BoostsController is deliberately not
 * registered, so nothing is reachable over HTTP and no boost row is ever
 * written. The feed multiplier is therefore a constant 1.0.
 *
 * To reactivate: import BoostsController and add it to `controllers`.
 */
@Module({
  controllers: [],
  providers: [BoostsService],
  exports: [BoostsService],
})
export class BoostsModule {}
