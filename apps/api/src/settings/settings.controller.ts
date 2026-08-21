import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { SettingsService } from './settings.service';
@ApiTags('settings') @ApiBearerAuth() @Controller({ path: 'settings', version: '1' })
export class SettingsController { constructor(private readonly service: SettingsService) {}
 @Get('organization') organization(){return this.service.organization();}
 @Patch('organization') @Roles('ADMIN') update(@Body() body:{name?:string;code?:string;timezone?:string},@Req() req:{user:AuthenticatedUser}){return this.service.updateOrganization(body,req.user);}
 @Get('integrations') integrations(){return this.service.integrations();}
 @Get('system') system(){return this.service.system();}
}
