import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OidcVerifierConfig, oidcIssuerFromEnv, oidcVerifierConfigFromEnv, realmRoles, verifyBearerToken } from '../auth/oidc-token';
import { swaggerUiAuthScript } from './swagger-ui-auth';

/** Swagger UI lives at /api (the global prefix); the spec at /api-json and /api-yaml. */
export const SWAGGER_UI_PATH = 'api';
export const SWAGGER_JSON_PATH = '/api-json';
export const SWAGGER_YAML_PATH = '/api-yaml';
/** Realm role a token needs to read the API spec. */
export const SWAGGER_REQUIRED_ROLE = 'ADMIN';

const PROTECTED_SPEC_ROUTES = new Set([SWAGGER_JSON_PATH, SWAGGER_YAML_PATH]);
/**
 * Helmet sends `Cross-Origin-Opener-Policy: same-origin`, which cuts the Keycloak sign-in popup off from the docs page,
 * so the token never reaches Swagger UI. Only the UI page (may open popups) and the OAuth2 redirect page (must reach
 * its opener) get a looser policy; every other response keeps Helmet's header.
 */
const DOCS_OPENER_POLICIES: Record<string, string> = {
  [`/${SWAGGER_UI_PATH}/`]: 'same-origin-allow-popups',
  [`/${SWAGGER_UI_PATH}/index.html`]: 'same-origin-allow-popups',
  [`/${SWAGGER_UI_PATH}/oauth2-redirect.html`]: 'unsafe-none',
};
const KEYCLOAK_SCHEME = 'keycloak';

/**
 * SWAGGER_ENABLED=true|1 turns the docs on, false|0 turns them off. Unset: on outside production, off when
 * NODE_ENV=production. When on, the spec still needs an ADMIN bearer token everywhere, production included.
 */
export function swaggerEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return env.NODE_ENV !== 'production';
}

export type SwaggerSetupOptions = {
  /** Token verification; defaults to the same OIDC settings as the AuthGuard. Tests pass a local JWKS. */
  verifier?: OidcVerifierConfig;
  /** Keycloak realm URL the docs sign-in redirects to; defaults to OIDC_ISSUER_URL (the public issuer). */
  issuerUrl?: string;
  /** Public OIDC client for the docs sign-in (authorization code + PKCE); defaults to SWAGGER_OAUTH_CLIENT_ID or simoes-web. */
  clientId?: string;
};

function keycloakScheme(issuerUrl: string) {
  const base = issuerUrl.replace(/\/+$/, '');
  return {
    type: 'oauth2' as const,
    description: 'Entrar com a conta Keycloak da aplicação (authorization code + PKCE). Requer o papel ADMIN.',
    flows: {
      authorizationCode: {
        authorizationUrl: `${base}/protocol/openid-connect/auth`,
        tokenUrl: `${base}/protocol/openid-connect/token`,
        scopes: { openid: 'OpenID Connect' },
      },
    },
  };
}

/** What the UI page embeds before sign-in: no paths, no schemas, only the sign-in scheme. */
export function shellDocument(full: OpenAPIObject): OpenAPIObject {
  return {
    openapi: full.openapi,
    info: {
      ...full.info,
      description: `${full.info.description ?? ''}\n\n**Entra com Authorize → ${KEYCLOAK_SCHEME} para carregar a referência da API.** É necessário o papel ${SWAGGER_REQUIRED_ROLE}.`,
    },
    paths: {},
    components: { securitySchemes: { [KEYCLOAK_SCHEME]: full.components!.securitySchemes![KEYCLOAK_SCHEME] } },
  };
}

function sendError(reply: FastifyReply, error: HttpException) {
  const status = error.getStatus();
  const message = status === 403 ? 'A documentação da API requer o papel ADMIN.' : 'É necessária autenticação.';
  return reply.code(status).header('cache-control', 'no-store').send({ code: `HTTP_${status}`, message });
}

/**
 * Mounts Swagger behind Keycloak:
 * - GET /api-json and /api-yaml need a valid bearer token (same checks as the AuthGuard) with the ADMIN realm role;
 *   401 without/with an invalid token, 403 without ADMIN.
 * - GET /api (redirected to /api/ so the OAuth2 redirect page resolves) serves the UI with an empty shell spec;
 *   the real spec is fetched by the browser only after sign-in (see swagger-ui-auth.ts).
 * Call only when Swagger is enabled; when it is not, none of these routes exist (404).
 */
export function setupSwagger(app: NestFastifyApplication, options: SwaggerSetupOptions = {}) {
  const verifier = options.verifier ?? oidcVerifierConfigFromEnv();
  const issuerUrl = options.issuerUrl ?? oidcIssuerFromEnv();
  const clientId = options.clientId ?? process.env.SWAGGER_OAUTH_CLIENT_ID ?? 'simoes-web';

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions?.url;
    if (route === `/${SWAGGER_UI_PATH}` && request.method === 'GET') {
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      return reply.redirect(`/${SWAGGER_UI_PATH}/${query}`, 302);
    }
    const openerPolicy = DOCS_OPENER_POLICIES[request.url.split('?')[0]];
    if (openerPolicy) reply.header('cross-origin-opener-policy', openerPolicy);
    if (!route || !PROTECTED_SPEC_ROUTES.has(route)) return;
    if (process.env.AUTH_DISABLED === 'true') return;
    try {
      const payload = await verifyBearerToken(request.headers.authorization, verifier);
      if (!realmRoles(payload).includes(SWAGGER_REQUIRED_ROLE)) throw new ForbiddenException();
    } catch (error) {
      return sendError(reply, error instanceof HttpException ? error : new UnauthorizedException());
    }
    reply.header('cache-control', 'no-store');
  });

  const config = new DocumentBuilder()
    .setTitle('SIMOES Management API')
    .setDescription('API da plataforma de gestão de infraestrutura e ciberdefesa')
    .setVersion('1.0')
    .addBearerAuth()
    .addOAuth2(keycloakScheme(issuerUrl), KEYCLOAK_SCHEME)
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const shell = shellDocument(document);

  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    yamlDocumentUrl: SWAGGER_YAML_PATH,
    // The UI's init script would otherwise embed the whole spec; it gets the shell instead.
    patchDocumentOnRequest: <TRequest>(request: TRequest, _reply: unknown, doc: OpenAPIObject) =>
      (request as FastifyRequest).url.split('?')[0].endsWith('/swagger-ui-init.js') ? shell : doc,
    customSiteTitle: 'SIMOES Management API',
    customJsStr: swaggerUiAuthScript(SWAGGER_JSON_PATH),
    swaggerOptions: {
      initOAuth: { clientId, usePkceWithAuthorizationCodeGrant: true, scopes: ['openid'] },
      plugins: [
        function downloadUrl(system: unknown) { return (globalThis as unknown as { SwaggerUIBundle: { plugins: { DownloadUrl: (s: unknown) => unknown } } }).SwaggerUIBundle.plugins.DownloadUrl(system); },
        function simoesDocsAuth(system: unknown) { return (globalThis as unknown as { SimoesDocsAuth: (s: unknown) => unknown }).SimoesDocsAuth(system); },
      ],
    },
  });
  return document;
}
