import { ApiPropertyOptional } from "@nestjs/swagger";
import { PaginationQueryDto } from "../../common/dto/pagination.dto.js";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CustomerArtisansQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({ enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] })
    @IsOptional() @IsIn(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'])
    verificationStatus?: string;

    @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
    @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() serviceId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) q?: string;
}