import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { extractBearerToken } from './guards/supabase-auth.guard.js';
import { ApiErrorDto, MessageResponseDto } from '../common/dto/api-error.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthResponseDto, AuthUserDto, OAuthUrlDto, SessionDto } from './dto/auth-response.dto.js';
import {
  ChangePasswordDto, ForgotPasswordDto, GoogleCallbackDto, OAuthStartQueryDto,
  RefreshTokenDto, ResetPasswordDto,
} from './dto/oauth.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  @RateLimit({ limit: 10, windowSeconds: 300, bucket: 'signup' })
  @ApiOperation({
    summary: 'Register a customer or artisan',
    description:
      'Creates the Supabase auth account, the Deevi user, the role and the matching profile. ' +
      'Artisans start at verification_status=PENDING and must complete onboarding before they can apply to jobs.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  signup(@Body() dto: SignupDto): Promise<AuthResponseDto> {
    return this.authService.signup(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 60, bucket: 'login' })
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiOkResponse({ type: MessageResponseDto })
  logout(@Headers('authorization') authorization: string): Promise<MessageResponseDto> {
    return this.authService.logout(extractBearerToken(authorization) ?? '');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'refresh' })
  @ApiOperation({ summary: 'Exchange a refresh token for a new session' })
  @ApiOkResponse({ schema: { properties: { session: { $ref: '#/components/schemas/SessionDto' } } } })
  refresh(@Body() dto: RefreshTokenDto): Promise<{ session: SessionDto }> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the authenticated principal',
    description: 'The single source of truth for roles and profile ids. Never infer these client-side.',
  })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentUser() user: AuthUser): AuthUserDto {
    return {
      id: user.id,
      authUserId: user.authUserId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: null,
      avatarUrl: user.avatarUrl,
      status: user.status,
      roles: user.roles,
      adminRole: user.adminRole,
      customerProfileId: user.customerProfileId,
      artisanProfileId: user.artisanProfileId,
      artisanVerificationStatus: user.artisanVerificationStatus,
    };
  }

  @Public()
  @Get('providers')
  @ApiOperation({
    summary: 'List available auth providers',
    description: 'Tells the client which sign-in buttons to show, and flags any provider running in mock mode.',
  })
  providers() {
    return this.authService.getProviderStatus();
  }

  @Public()
  @Get(':provider/url')
  @ApiOperation({
    summary: 'Start a social sign-in',
    description: 'Returns the provider authorization URL to redirect the user to. Currently supports `google`.',
  })
  @ApiOkResponse({ type: OAuthUrlDto })
  oauthUrl(@Param('provider') provider: string, @Query() query: OAuthStartQueryDto): Promise<OAuthUrlDto> {
    return this.authService.getOAuthUrl(provider, query);
  }

  @Public()
  @Post(':provider/callback')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSeconds: 60, bucket: 'oauth' })
  @ApiOperation({
    summary: 'Complete a social sign-in',
    description:
      'Pass `code` from the web redirect, or `idToken` from a native SDK. When Google credentials are not ' +
      'configured the mock adapter accepts any email address as the `code`, so the flow is testable end to end.',
  })
  @ApiBody({ type: GoogleCallbackDto })
  @ApiOkResponse({ type: AuthResponseDto })
  oauthCallback(
    @Param('provider') provider: string,
    @Body() dto: GoogleCallbackDto,
  ): Promise<AuthResponseDto> {
    return this.authService.handleOAuthCallback(provider, dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSeconds: 900, bucket: 'forgot-password' })
  @ApiOperation({ summary: 'Send a password reset email' })
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 900, bucket: 'reset-password' })
  @ApiOperation({ summary: 'Set a new password using a recovery token' })
  @ApiOkResponse({ type: MessageResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    return this.authService.resetPassword(dto.accessToken, dto.newPassword);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change my password', description: 'Requires the current password.' })
  @ApiOkResponse({ type: MessageResponseDto })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    return this.authService.changePassword(user, dto.currentPassword, dto.newPassword);
  }
}
