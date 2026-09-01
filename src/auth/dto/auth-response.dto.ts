import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionDto {
  @ApiProperty({ description: 'Send as `Authorization: Bearer <accessToken>`' })
  accessToken: string;
  @ApiProperty({ description: 'Use with POST /auth/refresh when the access token expires' })
  refreshToken: string;
  @ApiProperty({ example: 1735689600, description: 'Unix seconds' })
  expiresAt: number | null;
  @ApiProperty({ example: 3600 }) expiresIn: number | null;
  @ApiProperty({ example: 'bearer' }) tokenType: string;
}

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) authUserId: string;
  @ApiPropertyOptional({ nullable: true }) email: string | null;
  @ApiPropertyOptional({ nullable: true }) firstName: string | null;
  @ApiPropertyOptional({ nullable: true }) lastName: string | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl: string | null;
  @ApiProperty({ example: 'ACTIVE' }) status: string;
  @ApiProperty({ type: [String], example: ['CUSTOMER'] }) roles: string[];
  @ApiPropertyOptional({ nullable: true, example: null }) adminRole: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) customerProfileId: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) artisanProfileId: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'PENDING' }) artisanVerificationStatus: string | null;
}

export class AuthResponseDto {
  @ApiProperty({ example: 'Login successful' }) message: string;
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
  @ApiPropertyOptional({
    type: SessionDto,
    nullable: true,
    description: 'Null when the project requires email confirmation before a session is issued.',
  })
  session: SessionDto | null;
}

export class OAuthUrlDto {
  @ApiProperty() url: string;
  @ApiProperty({ example: 'google' }) provider: string;
  @ApiProperty({ description: 'True when a development stub is in use because the provider is not configured' })
  mocked: boolean;
}
