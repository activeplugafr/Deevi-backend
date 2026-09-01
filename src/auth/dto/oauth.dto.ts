import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { SIGNUP_ROLES } from './signup.dto.js';

export class OAuthStartQueryDto {
  @ApiPropertyOptional({
    enum: SIGNUP_ROLES,
    description: 'Role to assign if this Google account is signing up for the first time. Defaults to CUSTOMER.',
  })
  @IsOptional()
  @IsIn(SIGNUP_ROLES)
  role?: (typeof SIGNUP_ROLES)[number];

  @ApiPropertyOptional({ description: 'Where Google should return the user' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirectTo?: string;

  @ApiPropertyOptional({ description: 'Opaque CSRF value echoed back on the callback' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  state?: string;
}

export class GoogleCallbackDto {
  @ApiPropertyOptional({
    description:
      'Authorization code from the Google redirect. In mock mode (no Google credentials), pass any email address here.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiPropertyOptional({ description: 'id_token from a native mobile Google SDK. Use instead of `code`.' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  idToken?: string;

  @ApiPropertyOptional({ enum: SIGNUP_ROLES, description: 'Role for first-time sign-ups. Defaults to CUSTOMER.' })
  @IsOptional()
  @IsIn(SIGNUP_ROLES)
  role?: (typeof SIGNUP_ROLES)[number];

  @ApiPropertyOptional({ description: 'Must match the redirect_uri used to obtain the code' })
  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token from a previous session' })
  @IsString()
  @MaxLength(2048)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsString()
  @MaxLength(200)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Recovery access token from the emailed link' })
  @IsString()
  @MaxLength(4096)
  accessToken: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MaxLength(72)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MaxLength(72) newPassword: string;
}
