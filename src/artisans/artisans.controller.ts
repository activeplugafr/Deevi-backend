import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArtisansService } from './artisans.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { SignedUrlDto } from '../storage/dto/storage.dto.js';
import { SetArtisanServicesDto, UpdateArtisanProfileDto } from './dto/artisan-profile.dto.js';
import {
  AddPortfolioItemDto, AddVerificationDocumentDto, SetAvailabilityDto,
  SetServiceAreasDto, SubmitApplicationDto,
} from './dto/artisan-onboarding.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Artisans')
@Controller('artisans')
export class ArtisansController {
  constructor(private readonly artisans: ArtisansService) {}

  @Get('me')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Get my artisan profile',
    description: 'Includes services, service areas, availability, portfolio and the latest application.',
  })
  getMe(@CurrentUser() user: AuthUser) {
    return this.artisans.getMyProfile(user);
  }

  @Patch('me')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Update my artisan profile' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateArtisanProfileDto) {
    return this.artisans.updateMyProfile(user, dto);
  }

  @Put('me/services')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Set the services I offer',
    description: 'Replaces the whole list. Drives which jobs appear in my feed.',
  })
  setServices(@CurrentUser() user: AuthUser, @Body() dto: SetArtisanServicesDto) {
    return this.artisans.setServices(user, dto.services);
  }

  @Put('me/service-areas')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Set where I can work',
    description:
      'Replaces the whole list. Each area has a radius; jobs outside every area radius are filtered out ' +
      'of the feed entirely rather than merely ranked lower.',
  })
  setServiceAreas(@CurrentUser() user: AuthUser, @Body() dto: SetServiceAreasDto) {
    return this.artisans.setServiceAreas(user, dto.areas);
  }

  @Put('me/availability')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Set my weekly availability' })
  setAvailability(@CurrentUser() user: AuthUser, @Body() dto: SetAvailabilityDto) {
    return this.artisans.setAvailability(user, dto.slots);
  }

  @Post('me/portfolio')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Add a portfolio item' })
  addPortfolioItem(@CurrentUser() user: AuthUser, @Body() dto: AddPortfolioItemDto) {
    return this.artisans.addPortfolioItem(user, dto);
  }

  @Delete('me/portfolio/:id')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Remove a portfolio item' })
  @ApiOkResponse({ type: MessageResponseDto })
  removePortfolioItem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.artisans.removePortfolioItem(user, id);
  }

  @Get('me/verification-documents')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'List my verification documents',
    description: 'Metadata only. The files themselves are private and need a signed URL.',
  })
  listDocuments(@CurrentUser() user: AuthUser) {
    return this.artisans.listVerificationDocuments(user);
  }

  @Post('me/verification-documents')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Attach a verification document',
    description: 'Upload the file first with POST /storage/upload-ticket against the verification-documents bucket.',
  })
  addDocument(@CurrentUser() user: AuthUser, @Body() dto: AddVerificationDocumentDto) {
    return this.artisans.addVerificationDocument(user, dto);
  }

  @Get('me/verification-documents/:id/url')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Get a signed URL for one of my documents',
    description: 'Expires in 5 minutes. Only the owning artisan and authorised admins can mint one.',
  })
  @ApiOkResponse({ type: SignedUrlDto })
  getDocumentUrl(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.artisans.getVerificationDocumentUrl(user, id);
  }

  @Delete('me/verification-documents/:id')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Remove a verification document' })
  @ApiOkResponse({ type: MessageResponseDto })
  removeDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.artisans.removeVerificationDocument(user, id);
  }

  @Post('me/application')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Submit my application for verification',
    description:
      'Requires a headline or bio, at least one service, at least one service area and at least one ' +
      'document. Returns 422 listing exactly what is missing when the profile is not ready.',
  })
  submitApplication(@CurrentUser() user: AuthUser, @Body() dto: SubmitApplicationDto) {
    return this.artisans.submitApplication(user, dto.note);
  }

  @Get('me/application')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Check my application status',
    description: 'One of PENDING, UNDER_REVIEW, APPROVED, REJECTED or SUSPENDED.',
  })
  async myApplication(@CurrentUser() user: AuthUser) {
    const artisanId = this.artisans.requireArtisanId(user);
    return {
      verificationStatus: user.artisanVerificationStatus,
      application: await this.artisans.getLatestApplication(artisanId),
    };
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'View a public artisan profile',
    description:
      'Only approved artisans are visible. Contact details, exact coordinates and anything from the ' +
      'verification file are deliberately excluded.',
  })
  getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.artisans.getPublicProfile(id);
  }
}
