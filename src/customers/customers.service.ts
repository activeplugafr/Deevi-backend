import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { NotFoundError } from '../common/errors/domain.exception.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import type { AuthUser } from '../common/types/auth-user.js';
import { CustomerArtisansQueryDto } from './dto/artisans.dto.js';

const PROFILE_COLUMNS =
  'id, user_id, default_location_id, jobs_posted_count, jobs_completed_count, rating_average, rating_count, preferred_contact, created_at';

@Injectable()
export class CustomersService {
  constructor(private readonly db: DatabaseService) { }

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


  async listArtisans(query: CustomerArtisansQueryDto) {
    let builder = this.db.select(
      'artisan_profiles', 'id, user_id, headline, business_name, verification_status, availability_status, base_city, ' +
      'years_of_experience, rating_average, rating_count, jobs_completed_count, is_premium, ' +
    'profile_completion, approved_at, created_at, users(id, first_name, last_name, email, phone, status)'
    ).is('deleted_at', null).order('created_at', { ascending: false })

    if (query.verificationStatus) builder = builder.eq('verification_status', query.verificationStatus)
    if (query.city) builder = builder = builder.ilike('base_city', `%${query.city}%`)
    if (query.serviceId) {
      const { data } = await this.db.from('artisan_services').select('artisan_id').eq('service_id', query.serviceId);
      const ids = (data ?? []).map((r: any) => r.artisan_id);
      if (!ids.length) {
        return { items: [], meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      }
      builder = builder.in('id', ids.slice(0, 10_000));
    }
    return this.db.paginate(builder, query.page, query.limit)
  }

  async fetchArtisan(artisanId: string) {
    const artisan = await this.db.one(
      'artisan_profiles',
      'id, user_id, headline, business_name, verification_status, availability_status, base_city, ' +
      'years_of_experience, rating_average, rating_count, jobs_completed_count, is_premium, ' +
      'profile_completion, approved_at, created_at, users(id, first_name, last_name, email, phone, status)',
      { id: artisanId }
    );

    if (!artisan) throw new NotFoundError('Artisan');

    return artisan;
  }

  async saveArtisan(customerId: string, artisanId: string) {
    const artisan = await this.db.one<any>('artisan_profiles', 'id, user_id', { id: artisanId })
    if (!artisan) throw new NotFoundError('Artisan');

    if (artisan.user_id === customerId) {
      throw new BadRequestException(
        'You cannot save your own artisan profile.',
      );
    }

    const { data, error } = await this.db
      .from('saved_artisans')
      .upsert(
        {
          customer_id: customerId,
          artisan_id: artisanId,
        },
        {
          onConflict: 'customer_id,artisan_id',
          ignoreDuplicates: true,
        },
      )
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    return {
      message: 'Artisan saved successfully.',
      data,
    };


  }


  async getSavedArtisans(customerId: string) {
    const { data, error } = await this.db
      .from('saved_artisans')
      .select(`
        id,
        created_at,
        artisan:artisan_profiles (
          id,
          user_id,
          headline,
          business_name,
          verification_status,
          availability_status,
          base_city,
          years_of_experience,
          rating_average,
          rating_count,
          jobs_completed_count,
          is_premium,
          profile_completion,
          user:users (
            id,
            first_name,
            last_name,
            email,
            phone
          )
        )
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data ?? [];
  }


  async unsaveArtisan(customerId: string, artisanId: string) {
    const { data, error } = await this.db
      .from('saved_artisans')
      .delete()
      .eq('customer_id', customerId)
      .eq('artisan_id', artisanId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new NotFoundError('Saved artisan');
    }

    return {
      message: 'Artisan removed from saved list successfully.',
    };
  }

  async isArtisanSaved(customerId: string, artisanId: string) {
    const { data, error } = await this.db
      .from('saved_artisans')
      .select('id')
      .eq('customer_id', customerId)
      .eq('artisan_id', artisanId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return {
      isSaved: !!data,
    };
  }
}
