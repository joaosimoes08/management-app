import { Controller, Get, Req } from '@nestjs/common';
import { AuthenticatedUser } from './auth.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('auth')
@ApiBearerAuth()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  @Get('me')
  me(@Req() request: { user?: AuthenticatedUser }) {
    return request.user;
  }
}
