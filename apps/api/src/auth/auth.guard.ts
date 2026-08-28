import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly reflector: Reflector, private readonly authService: AuthService) {
    this.issuer = process.env.OIDC_ISSUER_URL ?? 'http://localhost:8080/realms/COCiber';
    this.audience = process.env.OIDC_AUDIENCE ?? 'simoes-api';
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/protocol/openid-connect/certs`));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    if (process.env.AUTH_DISABLED === 'true') return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; ip?: string; user?: unknown }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException();

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(authorization.slice('Bearer '.length), this.jwks, { issuer: this.issuer }));
      this.assertAudience(payload);
      if (!payload.sub || typeof payload.preferred_username !== 'string') throw new UnauthorizedException('Token sem identidade de utilizador');
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[AuthGuard] OIDC validation failed:', error instanceof Error ? error.message : error);
      }
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token inválido');
    }

    request.user = await this.authService.syncUser({
      externalId: payload.sub!,
      username: payload.preferred_username as string,
      displayName: typeof payload.name === 'string' ? payload.name : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      roles: this.extractRealmRoles(payload),
      ipAddress: request.ip,
    });
    return true;
  }

  private assertAudience(payload: JWTPayload): void {
    const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!audiences.includes(this.audience) && payload.azp !== this.audience) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[AuthGuard] Audience mismatch: expected=${this.audience}, aud=${audiences.join(',') || '(none)'}, azp=${payload.azp ?? '(none)'}`);
      }
      throw new UnauthorizedException('Audience inválida');
    }
  }

  private extractRealmRoles(payload: JWTPayload): string[] {
    const realmAccess = payload.realm_access;
    if (!realmAccess || typeof realmAccess !== 'object' || !Array.isArray((realmAccess as { roles?: unknown }).roles)) return [];
    return (realmAccess as { roles: unknown[] }).roles.filter((role): role is string => typeof role === 'string');
  }
}
