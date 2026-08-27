import { ArrayMinSize, ArrayMaxSize, IsArray, IsIn } from 'class-validator';
import { SELF_REQUEST_ROLES, SelfRequestRole } from './role-request.service';

export class CreateRoleRequestDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(SELF_REQUEST_ROLES.length) @IsIn(SELF_REQUEST_ROLES, { each: true })
  roles!: SelfRequestRole[];
}

export class DecideRoleRequestDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
}
