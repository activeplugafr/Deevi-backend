import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class CustomerProfileDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) default_location_id: string | null;
  @ApiProperty({ example: 4 }) jobs_posted_count: number;
  @ApiProperty({ example: 2 }) jobs_completed_count: number;
  @ApiProperty({ example: 4.8, type: Number }) rating_average: number;
  @ApiProperty({ example: 3 }) rating_count: number;
  @ApiProperty({ example: 'IN_APP' }) preferred_contact: string;
}

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Saved location to pre-fill on new job posts' })
  @IsOptional() @IsUUID()
  defaultLocationId?: string;

  @ApiPropertyOptional({ enum: ['IN_APP', 'PHONE', 'EMAIL'] })
  @IsOptional() @IsIn(['IN_APP', 'PHONE', 'EMAIL'])
  preferredContact?: string;
}
