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
