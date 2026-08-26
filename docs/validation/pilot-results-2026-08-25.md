# Fecho do gate de piloto — resultados

Data: 2026-08-25

Estado técnico: `PASS`.

Estado do gate de piloto: `BLOCKED` apenas pela sessão com operadores humanos.
As cinco tarefas foram validadas tecnicamente, mas a condição “sem assistência
técnica” não pode ser simulada nem substituída por automação.

## Resultado técnico

| Área | Estado | Resultado |
|---|---|---|
| Paridade `pt-PT` / `en-US` | PASS | 138 mensagens por chave e 403 textos legados cobertos; páginas operacionais verificadas nos dois locales |
| Testes unitários API | PASS | 22/22 |
| Testes HTTP NestJS/Fastify | PASS | 6/6 sobre PostgreSQL isolado |
| Migrations em base vazia | PASS | 17 migrations aplicadas em `simoes_http_test` |
| Build API e web | PASS | Prisma/TypeScript, Nest e Next.js 15.5.23 compilados |
| Workflow GitHub Actions | PASS | Node.js 22, PostgreSQL 18 e Redis 8; migrations, unitários, HTTP, i18n e builds |
| Matriz das cinco personas | PASS | API real com tokens Keycloak e validação visual pelo Computer |
| Proteção do último ADMIN | PASS | `LAST_ADMIN_REQUIRED`, role e sessão preservadas e operação auditada |
| Discovery idempotente | PASS | duas reapresentações mantiveram 1 IP, 1 Host, 1 Service e 1 evento de aprovação |
| Falha/recuperação Redis | PASS | estado indisponível controlado e recuperação sem reiniciar a aplicação |
| Falha/recuperação Keycloak | PASS | degradação controlada, serviço restaurado e sessão recuperada sem reiniciar a aplicação |
| Percurso porta → VLAN → subnet → IP → Host → Service | PASS | regresso à porta preservou `siteId`, `deviceId` e `interfaceId` |
| Piloto com cinco operadores reais | BLOCKED | requer sessão humana posterior sem assistência técnica |

Os testes HTTP mantêm controllers, services, Prisma, pipes, filtros, auditoria e
`RolesGuard` reais. Apenas a validação OIDC é substituída por identidades do
harness. A suite cobre autenticação, RBAC, scopes, herança e união de grupos,
modo legacy, Host multi-subnet, erros normalizados, auditoria, proteção do
último ADMIN e aprovação idempotente de Discovery.

## Matriz de personas

| Persona | Leitura | Mutação | Auditoria | Resultado |
|---|---|---|---|---|
| `ADMIN` | Global | Global | Leitura e eventos de mutação | PASS |
| `NETWORK_OPERATOR` scoped | Site/VLAN ancestrais e subnet `10.254.250.0/30` | Apenas no scope atribuído | Eventos das operações permitidas | PASS |
| `NETWORK_OPERATOR` legacy | Visibilidade legacy sem memberships | Permitida segundo a role legacy | Eventos das operações | PASS |
| `AUDITOR` | Global e auditoria | Negada (`403`) | Permitida em leitura | PASS |
| `READ_ONLY` | Global | Negada (`403`) | Negada (`403`) | PASS |

O scoped operator vê os ancestrais necessários para navegar até à subnet, mas
um recurso fora do scope devolve `404`. O `AUDITOR` e o `READ_ONLY` não veem
atalhos ou controlos de mutação; o `READ_ONLY` também não vê atividade/auditoria.

## Identidades e dados persistentes de QA

Foram criadas no realm `COCiber`, conforme autorização explícita:

- `qa-admin` — `ADMIN`
- `qa-network-scoped` — `NETWORK_OPERATOR`
- `qa-network-legacy` — `NETWORK_OPERATOR`, sem memberships IPAM
- `qa-auditor` — `AUDITOR`
- `qa-readonly` — `READ_ONLY`

As passwords geradas localmente permanecem apenas em `.env.qa`, com permissão
`0600`, e o ficheiro está ignorado pelo Git. O grupo `QA-NETWORK-SCOPED` tem
`READ`, `CREATE`, `UPDATE` e `DISCOVER` exclusivamente sobre
`10.254.250.0/30`.

O inventário persistente `QA-PILOT` inclui Site, edifício, sala, rack, switch,
servidor, interface, VLAN 4090, subnet `10.254.250.0/30`, IP
`10.254.250.2`, Host e Service TCP/443. O seed é idempotente e não substitui
nem apaga inventário existente.

## Baseline técnica

| Métrica | Resultado |
|---|---:|
| Dispositivos ativos navegáveis | 5/5 (100%) |
| Dispositivos com localização física | 5/5 (100%) |
| Dispositivos com IP de gestão | 5/5 (100%) |
| Interfaces com modo e VLAN documentados | 2/77 (2,6%) |
| Resultados Discovery pendentes antes da revisão | 1 |
| Resultados Discovery pendentes após a revisão | 0 |
| Pendentes há mais de 48 horas | 0 |
| Subnets revistas nos últimos 30 dias | 2/4 (50%) |
| Endereços IP duplicados | 0 |
| Ativos sem localização, modelo ou IP de gestão | 0 |
| Mediana humana para localizar um Host | Pendente da sessão com operadores |

## Defeitos encontrados e corrigidos

1. O PATCH parcial de subnet descartava a localização existente. Campos
   omitidos são agora preservados e a colocação só é revalidada quando muda.
2. O build da API misturava artefactos de `src` e `test`. A compilação limpa
   `dist` e exclui a suite de teste.
3. A proteção do último ADMIN não tinha permissão Keycloak para consultar
   utilizadores por role. Foi adicionada `query-users` e validado o erro real
   `LAST_ADMIN_REQUIRED`.
4. Um scoped operator conseguia ler a subnet pela API, mas não via os seus
   ancestrais Site/VLAN na UI. Os filtros expõem apenas os ancestrais exigidos
   para navegação, mantendo recursos fora do scope como `404`.
5. O Dashboard mostrava atalhos de mutação ao `AUDITOR` e atividade ao
   `READ_ONLY`. Os affordances e os dados de auditoria são agora filtrados por
   role, além da autorização no backend.
6. A inicialização Keycloak duplicava em React Strict Mode. A inicialização é
   agora idempotente no módulo.
7. O link IPAM dentro do popover de uma porta estava aninhado num controlo
   interativo. Foi separado, permitindo teclado e retorno de contexto fiável.
8. O tradutor legado não observava alterações tardias em `placeholder`,
   `aria-label` e `title`. Esses atributos e textos compostos são agora
   retraduzidos quando o locale muda.

## Evidências e reprodução

As capturas sem credenciais encontram-se no diretório de evidências desta
execução. Incluem as cinco personas, rack/switch/porta, Host/Service, Discovery
aprovado e indisponibilidade/recuperação de Redis e Keycloak.

```sh
npx dotenv -e .env -o -- sh -c \
  'export DATABASE_URL="${DATABASE_URL%/*}/simoes_http_test"; \
   npx prisma migrate deploy --schema packages/database/prisma/schema.prisma; \
   npm run i18n:check; \
   npm test --workspace=@simoes/api; \
   npm run test:http'

npm run build
node scripts/verify-qa-matrix.mjs
node scripts/verify-pilot-discovery.mjs
npm run pilot:baseline
git diff --check
```

A suite HTTP recusa deliberadamente bases cujo nome não termine em `_test`.
PostgreSQL nunca foi parado. Não foi feito reset, commit ou push.

## Trabalho humano ainda necessário

Cinco operadores reais devem executar as tarefas cegas e preencher o formulário
em `docs/validation/pilot-operator-guide.md`. Só depois dessa sessão podem ser
calculados a mediana humana, erros por tarefa e taxa de conclusão sem assistência.
