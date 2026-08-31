import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service.js';
import { LocationsService } from './locations.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { CustomerProfileDto, UpdateCustomerProfileDto } from './dto/customer.dto.js';
import { CreateLocationDto, LocationDto, UpdateLocationDto } from './dto/location.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly locations: LocationsService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my customer profile',
    description: 'Creates the profile on first access, so an artisan can post jobs too.',
  })
  @ApiOkResponse({ type: CustomerProfileDto })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.customers.getMyProfile(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my customer profile' })
  @ApiOkResponse({ type: CustomerProfileDto })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateCustomerProfileDto) {
    return this.customers.updateMyProfile(user, dto);
  }

  @Get('me/locations')
  @ApiOperation({
    summary: 'List my saved locations',
    description:
      'Saved locations pre-fill a job post. They are never applied implicitly: every job carries its own ' +
      'service location, because a customer often books work at an address they do not live at.',
  })
  @ApiOkResponse({ type: [LocationDto] })
  listLocations(@CurrentUser() user: AuthUser) {
    return this.locations.list(user.id);
  }

  @Post('me/locations')
  @ApiOperation({ summary: 'Save a location' })
  @ApiOkResponse({ type: LocationDto })
  createLocation(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationDto) {
    return this.locations.create(user.id, dto);
  }

  @Get('me/locations/:id')
  @ApiOperation({ summary: 'Get one saved location' })
  @ApiOkResponse({ type: LocationDto })
  getLocation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.locations.get(user.id, id);
  }

  @Patch('me/locations/:id')
  @ApiOperation({ summary: 'Update a saved location' })
  @ApiOkResponse({ type: LocationDto })
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(user.id, id, dto);
  }

  @Delete('me/locations/:id')
  @ApiOperation({ summary: 'Remove a saved location' })
  @ApiOkResponse({ type: MessageResponseDto })
  removeLocation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.locations.remove(user.id, id);
  }
}
