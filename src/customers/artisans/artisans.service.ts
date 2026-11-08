import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../supabase/database.service.js';
import { CustomerArtisansQueryDto } from '../dto/artisans.dto.js';
import { NotFoundError } from '../../common/errors/domain.exception.js';

@Injectable()
export class ArtisansService {
    constructor(private readonly db: DatabaseService) { }

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
