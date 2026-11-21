import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit bucket per verified user instead of per IP.
 *
 * Behind nginx every request arrives from the proxy's address, so an IP key would put all users in one bucket.
 * `request.user` is only set by AuthGuard after the bearer token's signature, issuer and audience are verified,
 * so it cannot be forged with a header. AuthModule registers this guard after AuthGuard so the user is known.
 * Requests without a verified user (public routes, AUTH_DISABLED) fall back to the IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    const user = request.user as { id?: unknown } | undefined;
    if (user && typeof user.id === 'string' && user.id) return `user:${user.id}`;
    return `ip:${String(request.ip ?? 'unknown')}`;
  }
}
