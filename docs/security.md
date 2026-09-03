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

## Segurança SNMP

- O container SNMP só contacta o `managementIp` e a porta registados num equipamento de rede visível.
- Credenciais são cifradas por envelope AES-256-GCM e o keyring não é guardado no PostgreSQL.
- Cada equipamento usa credenciais distintas para leitura, escrita e traps. Comunidades v2c e chaves v3 são write-only na API.
- SNMPv3 exige `authPriv`; SHA-1 requer compatibilidade explícita e MD5/DES são rejeitados.
- Redis transporta apenas UUIDs e a versão do contrato.
- Traps têm autorização local, validação adicional de origem/credencial, rate limit, limite de 32 KiB e máximo de 128 varbinds.
- Os IPs de escuta são obtidos diretamente do host e validados novamente antes de gerar bindings Docker; a API não aceita endereços arbitrários.
- O agente do host não recebe o keyring e usa uma role PostgreSQL limitada às duas tabelas de configuração de listeners. O acesso ao Docker e aos ficheiros Compose fica restrito à conta operacional do agente.
- SET aceita apenas operações predefinidas, não tem retry automático e está desligado por defeito na API e no worker.
- Discovery SNMP exige um pré-registo por Site e IP com credencial TRAP exclusiva; não existe captura anónima nem wildcard de comunidades.
- O modo opcional de autoteste por Docker Desktop está desligado por defeito, aceita apenas SNMPv3 autenticado e só associa um único pré-registo cujo IP seja uma interface recente e selecionada do host. As origens proxy são allowlisted; aceitar uma origem traduzida arbitrária requer uma segunda flag explícita, apenas para desenvolvimento. O IP observado permanece no evento e este é marcado `SELF_TEST`.
- Quando a aceitação de origem traduzida está ativa, o componente emite um aviso de segurança explícito no arranque; a configuração é recusada se o modo geral de autoteste não estiver também ativo.
- Pré-registos expiram ao fim de 24 horas. O receiver ignora inscrições expiradas e remove o respetivo envelope, mantendo apenas o evento de auditoria.
- Aceitar um candidato transfere o mesmo envelope para uma credencial TRAP do equipamento numa transação; o segredo não é duplicado nem devolvido ao frontend.
- Apenas ADMIN introduz ou elimina segredos de pré-registo. NETWORK_OPERATOR pode aceitar um candidato dentro do seu scope, sem acesso ao segredo.

### Ameaças principais

| Ameaça | Risco | Controlo |
|---|---|---|
| Roubo de credenciais na base de dados | Alto | Envelope encryption e keyring externo |
| Job Redis manipulado | Alto | Payload versionado com UUID; destino e operação relidos da base de dados |
| Trap forjada ou flood UDP | Alto | Authorizer, associação a IP/credencial, limites e rate limiting |
| Pré-registo usado por outro emissor | Alto | IP exato, identidade autenticada, expiração de 24h e credencial exclusiva |
| Corrida na aceitação de candidato | Alto | Transação serializable, verificação do IP dentro da transação e operação idempotente |
| Alteração indevida via SET | Crítico | ADMIN, templates allowlisted, flag dupla, preflight e verificação |
| Exposição em logs/erros | Alto | Redaction estrutural e códigos de erro públicos |

Antes de ativar SET deve ser realizado um teste laboratorial por modelo de equipamento e uma revisão de segurança independente.
