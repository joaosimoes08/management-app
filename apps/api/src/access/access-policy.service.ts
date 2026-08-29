import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.service';

export type ScopedAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
export type IpamAction = ScopedAction | 'DISCOVER' | 'IMPORT';

@Injectable()
export class AccessPolicyService {
  isAdmin(user: AuthenticatedUser) { return user.roles.includes('ADMIN'); }

  hasApplicationRole(user: AuthenticatedUser) {
    return user.roles.some((role) => ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'].includes(role));
  }

  canReadScoped(user: AuthenticatedUser) {
    return this.isAdmin(user) || user.roles.some((role) =>
      ['NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'].includes(role));
  }

  canManagePhysical(user: AuthenticatedUser, action: ScopedAction) {
    return action === 'READ' ? this.canReadScoped(user) : this.isAdmin(user) || user.roles.includes('SYSTEMS_OPERATOR');
  }

  canManageDevice(user: AuthenticatedUser, action: ScopedAction, type?: string | null) {
    if (action === 'READ') return this.canReadScoped(user);
    if (this.isAdmin(user) || user.roles.includes('SYSTEMS_OPERATOR')) return true;
    return user.roles.includes('NETWORK_OPERATOR') && Boolean(type && ['SWITCH', 'ROUTER', 'FIREWALL'].includes(type));
  }

  canUseIpam(user: AuthenticatedUser, action: IpamAction) {
    if (this.isAdmin(user)) return true;
    if (action === 'READ') return user.roles.some((role) => ['NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'].includes(role));
    return user.roles.includes('NETWORK_OPERATOR');
  }

  capabilities(user: AuthenticatedUser) {
    return {
      administer: this.isAdmin(user),
      network: this.isAdmin(user) || user.roles.includes('NETWORK_OPERATOR'),
      systems: this.isAdmin(user) || user.roles.includes('SYSTEMS_OPERATOR'),
      audit: this.isAdmin(user) || user.roles.includes('AUDITOR'),
      readOnly: user.roles.includes('READ_ONLY'),
    };
  }
}
