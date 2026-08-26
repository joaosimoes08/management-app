# Autenticação, autorização e segurança

## Keycloak

O ambiente atual usa utilizadores locais do realm `COCiber`. Não existe LDAP nesta fase.

O realm é importado a partir de `infra/keycloak/realm-cociber.json`. Existem dois clients com responsabilidades diferentes:

- `simoes-api`: confidential, usado pela API e testes direct grant.
- `simoes-web`: public, usado pelo browser com Authorization Code + PKCE. Nunca deve ter client secret.
- `simoes-settings-admin`: confidential, limitado a `manage-users` e `query-users` para gerir roles da aplicação e proteger o último ADMIN.

## API

O `AuthGuard` valida assinatura JWT via JWKS, issuer, audience/azp e a identidade do utilizador. `AUTH_DISABLED=false` deve ser usado quando a API está ligada ao Keycloak.

## Roles suportadas

```text
ADMIN
NETWORK_OPERATOR
SYSTEMS_OPERATOR
STORAGE_OPERATOR
AUDITOR
READ_ONLY
```

A lista técnica está em `apps/api/src/auth/roles.ts`. Para adicionar uma role:

1. Criá-la no realm Keycloak.
2. Adicioná-la a `roles.ts`.
3. Adicioná-la ao enum `RoleName` do Prisma.
4. Criar uma migração.
5. Aplicá-la nos controllers com `@Roles('NOME_DA_ROLE')`.

## Proteções base

- Inputs não permitidos são rejeitados.
- CORS é configurável através de `CORS_ORIGINS`.
- Rate limiting global: 100 pedidos por minuto.
- Helmet adiciona headers de segurança.
- Health check não requer autenticação.
- Secrets não devem ser commitados.
- Credenciais de produção não devem reutilizar valores de desenvolvimento.

As verificações de disponibilidade do portal fazem pedidos HTTP a URLs configuradas por administradores. Antes de produção, devem ser complementadas com allowlists de destinos, limites de rede e proteção explícita contra SSRF.
