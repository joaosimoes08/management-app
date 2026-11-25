import { applyDecorators, Type } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { ApiExampleKey, examplesFor } from './examples/registry';

type ResponseOptions = { description?: string; type?: Type<unknown> | [Type<unknown>]; isArray?: boolean };

/** Request body with named examples from the registry. `type` keeps the DTO schema in the spec. */
export function ApiBodyExamples(type: Type<unknown>, ...keys: [ApiExampleKey, ...ApiExampleKey[]]) {
  return applyDecorators(ApiBody({ type, examples: examplesFor(keys) }));
}

/** 200 response with named examples from the registry. */
export function ApiOkExamples(keys: [ApiExampleKey, ...ApiExampleKey[]], options: ResponseOptions = {}) {
  return applyDecorators(ApiOkResponse({ description: options.description ?? 'OK', ...(options.type ? { type: options.type } : {}), ...(options.isArray ? { isArray: true } : {}), examples: examplesFor(keys) }));
}

/** 201 response with named examples from the registry. */
export function ApiCreatedExamples(keys: [ApiExampleKey, ...ApiExampleKey[]], options: ResponseOptions = {}) {
  return applyDecorators(ApiCreatedResponse({ description: options.description ?? 'Created', ...(options.type ? { type: options.type } : {}), ...(options.isArray ? { isArray: true } : {}), examples: examplesFor(keys) }));
}
