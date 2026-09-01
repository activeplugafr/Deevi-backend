import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { DeactivateAccountDto, UpdateUserDto, UserProfileDto } from './dto/user.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my account' })
  @ApiOkResponse({ type: UserProfileDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my account',
    description: 'Pass `avatarPath` from a storage upload ticket to change the profile picture.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserDto) {
    return this.users.updateMe(user, dto);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Deactivate my account',
    description:
      'Soft deactivation. Job history, reviews and disputes are retained because the other party ' +
      'still needs them.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  deactivate(@CurrentUser() user: AuthUser, @Body() dto: DeactivateAccountDto) {
    return this.users.deactivate(user, dto.reason);
  }
}
