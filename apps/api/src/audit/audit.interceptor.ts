import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService, private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return next.handle();
    const request = context.switchToHttp().getRequest<{ method: string; url: string; ip?: string; user?: AuthenticatedUser }>();
    // Reads (GET/HEAD) are not audited: they were 99 % of AuditLog rows and made every audit query scan them.
    // Mutations keep their HTTP_REQUEST rows. Recorded in docs/performance/step-20-audit-writes.md.
    if (request.method === 'GET' || request.method === 'HEAD') return next.handle();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      tap(() => {
        void this.audit.record({
          userId: request.user?.id,
          action: `${request.method} ${request.url}`,
          entityType: 'HTTP_REQUEST',
          metadata: { statusCode: response.statusCode },
          ipAddress: request.ip,
        }).catch(() => undefined);
      }),
    );
  }
}
