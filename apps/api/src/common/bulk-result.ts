import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';

/** Error body for one item of a bulk action, in the same { code, message } shape the API returns for single calls. */
export function errorBody(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const body = typeof response === 'object' && response ? response as { code?: string; message?: string | string[] } : { message: String(response) };
    const fallback = error instanceof NotFoundException ? 'NOT_FOUND' : error instanceof ForbiddenException ? 'FORBIDDEN' : error instanceof ConflictException ? 'CONFLICT' : 'BAD_REQUEST';
    return { statusCode: error.getStatus(), code: body.code ?? fallback, message: Array.isArray(body.message) ? body.message.join('; ') : body.message ?? error.message };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Erro inesperado.' };
}
