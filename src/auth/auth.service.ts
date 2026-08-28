import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { SignupDto } from './dto/signup.dto.js';
import { LoginDto } from './dto/login.dto.js';


@Injectable()
export class AuthService {
    constructor(
        private readonly supabaseService: SupabaseService,
    ) { }

    private get supabase() {
        return this.supabaseService.getClient();
    }

    async signup(signupDto: SignupDto) {
        const {
            email,
            password,
            firstName,
            lastName,
            phone,
            role,
        } = signupDto;

        // 1. Create the authentication account in Supabase Auth
        const { data: authData, error: authError } =
            await this.supabase.auth.signUp({
                email,
                password,
            });

        if (authError) {
            throw new BadRequestException(authError.message);
        }

        if (!authData.user) {
            throw new BadRequestException(
                'Unable to create authentication account',
            );
        }

        const authUserId = authData.user.id;

        // 2. Create the Deevi user record
        const { data: user, error: userError } =
            await this.supabase
                .from('users')
                .insert({
                    auth_user_id: authUserId,
                    first_name: firstName,
                    last_name: lastName,
                    phone: phone ?? null,
                })
                .select()
                .single();

        if (userError) {
            // Important:
            // Auth user was already created.
            // We should clean it up if creating the Deevi profile fails.
            await this.supabase.auth.admin.deleteUser(authUserId);

            throw new BadRequestException(userError.message);
        }

        // 3. Create the user's role
        const { error: roleError } =
            await this.supabase
                .from('user_roles')
                .insert({
                    user_id: user.id,
                    role,
                });

        if (roleError) {
            await this.supabase.auth.admin.deleteUser(authUserId);

            throw new BadRequestException(roleError.message);
        }

        // 4. Create the appropriate profile
        if (role === 'CUSTOMER') {
            const { error } = await this.supabase
                .from('customer_profiles')
                .insert({
                    user_id: user.id,
                });

            if (error) {
                await this.supabase.auth.admin.deleteUser(authUserId);

                throw new BadRequestException(error.message);
            }
        }

        if (role === 'ARTISAN') {
            const { error } = await this.supabase
                .from('artisan_profiles')
                .insert({
                    user_id: user.id,
                });

            if (error) {
                await this.supabase.auth.admin.deleteUser(authUserId);

                throw new BadRequestException(error.message);
            }
        }

        return {
            message: 'Account created successfully',
            user: {
                id: user.id,
                authUserId: user.auth_user_id,
                firstName: user.first_name,
                lastName: user.last_name,
                phone: user.phone,
                role,
            },
            session: authData.session,
        };
    }

    async login(loginDto: LoginDto) {
        const { email, password } = loginDto;

        const { data, error } =
            await this.supabase.auth.signInWithPassword({
                email,
                password,
            });

        if (error) {
            throw new UnauthorizedException(
                'Invalid email or password',
            );
        }

        if (!data.user || !data.session) {
            throw new UnauthorizedException(
                'Unable to create session',
            );
        }

        // Get the Deevi user
        const { data: user, error: userError } =
            await this.supabase
                .from('users')
                .select('*')
                .eq('auth_user_id', data.user.id)
                .single();

        if (userError || !user) {
            throw new UnauthorizedException(
                'Deevi user profile not found',
            );
        }

        // Get roles
        const { data: roles, error: rolesError } =
            await this.supabase
                .from('user_roles')
                .select('role')
                .eq('user_id', user.id);

        if (rolesError) {
            throw new UnauthorizedException(
                'Unable to retrieve user roles',
            );
        }

        return {
            message: 'Login successful',

            user: {
                id: user.id,
                authUserId: user.auth_user_id,
                firstName: user.first_name,
                lastName: user.last_name,
                phone: user.phone,
                avatarUrl: user.avatar_url,
                roles: roles.map((item) => item.role),
            },

            session: {
                accessToken: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresAt: data.session.expires_at,
            },
        };
    }

    async logout(accessToken: string) {
        const { error } =
            await this.supabase.auth.admin.signOut(accessToken);

        if (error) {
            throw new BadRequestException(error.message);
        }

        return {
            message: 'Logged out successfully',
        };
    }
}











// import { Injectable } from '@nestjs/common';

// @Injectable()
// export class AuthService {}
