import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

const FALLBACK_MESSAGES: Record<number, string> = {
  400: 'O pedido não é válido.',
  401: 'É necessária autenticação.',
  403: 'Não tens permissão para esta operação.',
  404: 'O recurso não foi encontrado.',
  409: 'A operação entra em conflito com o estado atual.',
  429: 'Foram efetuados demasiados pedidos.',
  500: 'Ocorreu um erro interno.',
  502: 'Um serviço externo não respondeu corretamente.',
  503: 'O serviço está temporariamente indisponível.',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status: (status: number) => { send: (body: unknown) => void } }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const messages = Array.isArray(value.message) ? value.message.filter((item): item is string => typeof item === 'string') : undefined;
    const candidate = typeof value.message === 'string' ? value.message : typeof raw === 'string' ? raw : undefined;
    const genericNestMessages = new Set(['Bad Request', 'Unauthorized', 'Forbidden resource', 'Not Found', 'Conflict', 'Internal server error']);
    const message = candidate && !genericNestMessages.has(candidate) ? candidate : FALLBACK_MESSAGES[status] ?? FALLBACK_MESSAGES[500];
    const code = typeof value.code === 'string' ? value.code : status === 400 && messages ? 'VALIDATION_ERROR' : `HTTP_${status}`;
    const details = value.details ?? (messages ? { errors: messages } : undefined);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(status).send({ code, message, ...(details === undefined ? {} : { details }) });
  }
}
