import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorageService } from './storage.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { CreateUploadTicketDto, UploadTicketDto } from './dto/storage.dto.js';
import { StorageBucket } from './storage.constants.js';
import { ForbiddenError } from '../common/errors/domain.exception.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload-ticket')
  @RateLimit({ limit: 40, windowSeconds: 60, bucket: 'upload' })
  @ApiOperation({
    summary: 'Request a signed upload URL',
    description:
      'The client uploads bytes directly to Supabase Storage with the returned URL, then submits the ' +
      'returned `path` when creating the job media, portfolio item, verification document or message ' +
      'attachment. File type, size and destination are validated here before any URL is issued.',
  })
  @ApiOkResponse({ type: UploadTicketDto })
  async createTicket(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadTicketDto,
  ): Promise<UploadTicketDto> {
    // Verification documents belong to the artisan onboarding flow only.
    if (dto.bucket === StorageBucket.VERIFICATION_DOCUMENTS && !user.artisanProfileId) {
      throw new ForbiddenError('Only artisans can upload verification documents');
    }
    if (dto.bucket === StorageBucket.PORTFOLIO && !user.artisanProfileId) {
      throw new ForbiddenError('Only artisans can upload portfolio images');
    }

    return this.storage.createUploadTicket(
      dto.bucket, user.id, dto.filename, dto.mimeType, dto.sizeBytes,
    );
  }
}
