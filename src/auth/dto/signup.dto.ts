import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';

export const SIGNUP_ROLES = ['CUSTOMER', 'ARTISAN'] as const;

export class SignupDto {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  @ApiProperty({
    example: 'Str0ngPassw0rd',
    minLength: 8,
    description: 'At least 8 characters, including a letter and a number',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'Password must contain at least one letter and one number',
  })
  password: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName: string;

  @ApiProperty({ example: 'Obi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Phone number must be 7-15 digits, optionally starting with +' })
  phone?: string;

  @ApiProperty({
    enum: SIGNUP_ROLES,
    description: 'ADMIN accounts are never self-registered; they are created by an existing SUPER_ADMIN.',
  })
  @IsIn(SIGNUP_ROLES)
  role: (typeof SIGNUP_ROLES)[number];
}
