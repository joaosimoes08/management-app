# API docs (Swagger)

- UI: `GET /api/` (empty until you sign in). Spec: `GET /api-json`, `GET /api-yaml` — bearer token with the `ADMIN` realm role required (401 without/invalid token, 403 without ADMIN).
- `SWAGGER_ENABLED`: unset → on outside production, off when `NODE_ENV=production`; `true`/`false` override. Off → all docs routes return 404.
- Sign-in: Authorize → `keycloak` → Authorize. Uses the public `simoes-web` client (override with `SWAGGER_OAUTH_CLIENT_ID`) with PKCE; the client needs `<api-origin>/api/oauth2-redirect.html` as a redirect URI and `<api-origin>` as a web origin.

## Adding request/response examples

1. Add or extend `examples/<area>.examples.ts` with a `const <area>Examples = { '<area>.<action>[.request|.response]': { summary, description?, value } } satisfies Record<string, ApiExample>`.
2. Spread it into `API_EXAMPLES` in `examples/registry.ts` (keys are type-checked from there).
3. On the controller method use `@ApiBodyExamples(Dto, 'key')`, `@ApiOkExamples(['key'])` or `@ApiCreatedExamples(['key'])` from `api-examples.decorator.ts`.

See `GET /v1/tags` and `POST /v1/tags` for the pattern.
