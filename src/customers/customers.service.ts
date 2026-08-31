import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { NotFoundError } from '../common/errors/domain.exception.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import type { AuthUser } from '../common/types/auth-user.js';

const PROFILE_COLUMNS =
  'id, user_id, default_location_id, jobs_posted_count, jobs_completed_count, rating_average, rating_count, preferred_contact, created_at';

@Injectable()
export class CustomersService {
  constructor(private readonly db: DatabaseService) {}

  /** Creates the profile on demand so an ARTISAN can also post jobs. */
  async ensureProfile(user: AuthUser): Promise<any> {
    const existing = await this.db.maybeOne(
      'customer_profiles', PROFILE_COLUMNS, { user_id: user.id },
    );
    if (existing) return existing;

    const profile = await this.db.insertOne('customer_profiles', { user_id: user.id }, PROFILE_COLUMNS);
    await this.db.from('user_roles')
      .upsert({ user_id: user.id, role: 'CUSTOMER' }, { onConflict: 'user_id,role', ignoreDuplicates: true });
    return profile;
  }

  async getMyProfile(user: AuthUser) {
    const profile = await this.ensureProfile(user);

    const [openJobs, activeJobs] = await Promise.all([
      this.db.from('job_posts').select('id', { count: 'exact', head: true })
        .eq('customer_id', user.id).is('deleted_at', null)
        .in('status', ['PUBLISHED', 'RECEIVING_APPLICATIONS']),
      this.db.from('jobs').select('id', { count: 'exact', head: true })
        .eq('customer_id', user.id).in('status', ['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS']),
    ]);

    return {
      ...profile,
      stats: {
        openJobPosts: openJobs.count ?? 0,
        activeJobs: activeJobs.count ?? 0,
        jobsCompleted: profile.jobs_completed_count,
      },
    };
  }

  async updateMyProfile(user: AuthUser, values: { defaultLocationId?: string; preferredContact?: string }) {
    await this.ensureProfile(user);

    if (values.defaultLocationId) {
      const location = await this.db.maybeOne('locations', 'id', {
        id: values.defaultLocationId, user_id: user.id, deleted_at: null,
      });
      if (!location) throw new NotFoundError('Location');
    }

    return this.db.updateOne('customer_profiles', { user_id: user.id }, compact({
      default_location_id: values.defaultLocationId,
      preferred_contact: values.preferredContact,
    }), PROFILE_COLUMNS, 'Customer profile');
  }
}
