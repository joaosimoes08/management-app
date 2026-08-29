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
AUDITOR
READ_ONLY
```

As roles definem capacidades; os grupos definem os Sites e scopes onde essas capacidades podem ser usadas. `STORAGE_OPERATOR` deixou de ser atribuível e permanece apenas no enum histórico da base de dados para permitir identificar e reassociar utilizadores antigos sem promoção automática.

- `ADMIN` administra toda a plataforma e ignora os scopes dos grupos.
- `NETWORK_OPERATOR` opera IPAM, Discovery, interfaces e equipamentos de rede nos Sites atribuídos.
- `SYSTEMS_OPERATOR` opera a hierarquia física, bastidores e equipamentos nos scopes atribuídos.
- `AUDITOR` lê os recursos atribuídos e consulta Auditoria.
- `READ_ONLY` apenas lê os recursos atribuídos.

Para não administradores, uma associação a um Site torna-o selecionável, mas não concede por si só acesso a dados. IPAM exige ações na associação Grupo–Site; Infraestrutura exige uma ACL aplicável em `SITE`, `BUILDING` ou `ROOM`. Matrizes mais específicas substituem integralmente a matriz herdada.

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
