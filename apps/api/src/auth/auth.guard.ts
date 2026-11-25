import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JWTVerifyGetKey } from 'jose';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthService } from './auth.service';
import { oidcVerifierConfigFromEnv, realmRoles, verifyBearerToken } from './oidc-token';

export { resolveJwksUrl } from './oidc-token';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly reflector: Reflector, private readonly authService: AuthService) {
    ({ issuer: this.issuer, audience: this.audience, jwks: this.jwks } = oidcVerifierConfigFromEnv());
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    if (process.env.AUTH_DISABLED === 'true') return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; ip?: string; user?: unknown }>();
    const payload = await verifyBearerToken(request.headers.authorization, { issuer: this.issuer, audience: this.audience, jwks: this.jwks });

    request.user = await this.authService.syncUser({
      externalId: payload.sub!,
      username: payload.preferred_username as string,
      displayName: typeof payload.name === 'string' ? payload.name : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      roles: realmRoles(payload),
      ipAddress: request.ip,
    });
    return true;
  }
}
