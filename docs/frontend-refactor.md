# Refatoração do frontend — arquitetura feature/domain

Registo da refatoração estrutural e de type-safety do frontend (`apps/web`), executada no branch `refactor/web-feature-domain-architecture`. A refatoração preservou rotas, contratos de API, comportamento de autenticação, permissões, traduções e UI — foi uma mudança estrutural, não funcional.

## Objetivos

- Organizar o frontend por **domínio de negócio** em vez de pastas globais horizontais (`components/`, `lib/`).
- `app/` responsável apenas por routing, layouts e composição de páginas.
- Código de domínio (componentes, tipos, chamadas API, hooks) junto da feature que o possui.
- Type-safety real: zero `@ts-nocheck` e zero `any`.
- Camada de transporte HTTP separada da autenticação.
- React Query para server-state, com query keys estáveis e por domínio.

## Estrutura final de `apps/web`

```text
apps/web/
├── app/                            # Routing e composição (páginas finas)
│   ├── ajuda/                      # Conteúdo estático de ajuda
│   ├── auditoria/page.tsx          # wrapper → features/audit
│   ├── definicoes/page.tsx         # wrapper → features/settings
│   ├── descoberta/page.tsx         # wrapper → features/discovery
│   ├── infraestrutura/page.tsx     # wrapper → features/infrastructure
│   ├── ipam/                       # /ipam e /ipam/new-subnet → features/ipam
│   ├── perfil/page.tsx             # wrapper → features/profile
│   ├── portal/page.tsx             # wrapper → features/portal
│   ├── setup/page.tsx              # wrapper → features/setup
│   ├── page.tsx                    # wrapper → features/dashboard
│   ├── layout.tsx                  # AuthProvider → I18nProvider → ToastProvider
│   │                               #   → AuthGate → QueryProvider → SiteProvider
│   ├── error.tsx                   # Error boundary global
│   ├── not-found.tsx
│   └── globals.css
│
├── features/
│   ├── infrastructure/             # Domínio de referência
│   │   ├── infrastructure-workspace.tsx   # Orquestrador (ex--next)
│   │   ├── api.ts                  # Endpoints tipados do domínio
│   │   ├── types.ts                # Site, Building, Room, Rack, Device,
│   │   │                           #   DeviceModel, DeviceInterface, AssetFile,
│   │   │                           #   PortLayout, RackPlacementPlan, EffectiveAccess
│   │   ├── utils.ts                # Geometria de rack, port layout, contexto localStorage
│   │   ├── forms.ts                # Form state types
│   │   └── components/
│   │       ├── rack/               # RackWorkspace, RackDetail, RackDeviceZoom,
│   │       │                       #   RackEquipmentPreview, RackEquipmentOverlay
│   │       ├── devices/            # DeviceList
│   │       ├── models/             # ModelList, InterfaceWorkspace, InterfaceEditor,
│   │       │                       #   PortLayoutEditor
│   │       ├── assets/             # AssetList, AssetUploadModal
│   │       ├── sites/              # BuildingModal, RoomModal
│   │       ├── editors/            # EntityEditor (equipamento/bastidor/modelo)
│   │       ├── device-image-frame.tsx
│   │       ├── asset-image.tsx     # Imagens autenticadas via object URL
│   │       └── equipment-type-icon.tsx
│   │
│   ├── ipam/
│   │   ├── ipam-page.tsx           # Orquestrador
│   │   ├── new-subnet-page.tsx
│   │   ├── api.ts · types.ts · utils.ts
│   │   └── components/             # NetworkMap, SubnetsView, HostPanel,
│   │                               #   CalculatorView, IpamModal, CentralPermissions
│   │
│   ├── settings/                   # /definicoes
│   │   ├── settings-page.tsx
│   │   └── components/             # AccessGroupsSettings, InfrastructurePermissions
│   ├── dashboard/                  # api.ts + dashboard-page.tsx
│   ├── audit/                      # api.ts + audit-page.tsx
│   ├── discovery/                  # api.ts + discovery-page.tsx
│   ├── portal/                     # api.ts + portal-page.tsx
│   ├── setup/                      # api.ts + setup-page.tsx
│   └── profile/                    # api.ts + profile-page.tsx
│
├── components/
│   ├── ui/                         # modal.tsx, toast.tsx (partilhados)
│   └── layout/                     # app-shell.tsx, app-sidebar.tsx, app-header.tsx,
│                                   #   user-menu.tsx, global-search.tsx,
│                                   #   site-switcher.tsx, auth-gate.tsx,
│                                   #   navigation.ts, topbar-state.ts
│
├── lib/
│   ├── auth/                       # auth-provider.tsx, use-auth.ts, keycloak.ts,
│   │                               #   types.ts (Keycloak isolado)
│   ├── api/                        # client.ts (apiFetch tipado), types.ts
│   │                               #   (PaginatedResponse, ApiError), errors.ts
│   ├── i18n/                       # i18n.tsx + legacy-messages.ts (dicionário PT→EN)
│   ├── query/                      # QueryProvider (React Query)
│   └── site-context.tsx
│
└── icons/ · public/                # Assets
```

## Principais mudanças

### 1. Domínios extraídos para `features/`

- **Infrastructure** (domínio de referência): o god component `infrastructure-workspace-next.tsx` (560 linhas, ~40 `useState`, tudo por `useEffect`+`apiFetch`) foi dividido em 17 componentes coesos (racks, devices, models, assets, sites, editors) com `api.ts` e `types.ts` próprios. O ficheiro legado `infrastructure-workspace.tsx` foi eliminado — os seus subcomponentes partilhados foram extraídos para a feature e o workspace duplicado (morto) removido. O nome temporário `-next` deixou de existir.
- **IPAM**: `app/ipam/page.tsx` (denso, `@ts-nocheck`) dividido em orquestrador + NetworkMap, SubnetsView, HostPanel, CalculatorView, modais. `PermissionsView` morto removido; placeholder de permissões centralizadas movido para a feature.
- **Restantes domínios** (settings, dashboard, audit, discovery, portal, setup, profile): páginas movidas para features com wrappers finos em `app/`; `access-groups-settings` e `infrastructure-permissions` tipados e integrados na feature de settings.
- **App shell**: `app-shell.tsx` dividido em `app-sidebar`, `app-header`, `user-menu`, `global-search`, `navigation.ts` e `topbar-state.ts`.

### 2. Separação auth ↔ transporte HTTP

- `apiFetch<T>` saiu do `AuthProvider` para `lib/api/client.ts`. A autenticação apenas registra um *token provider* e um handler de 401 (`setApiTokenProvider` / `setApiUnauthorizedHandler`); o cliente HTTP nunca toca no adaptador Keycloak.
- `useAuth()` deixou de expor `apiFetch` — os consumidores usam funções de API tipadas por domínio.
- O fluxo Keycloak (PKCE, silent-check-sso, refresh single-flight a cada 30s, logout por expiração) foi preservado sem alterações.

### 3. Tipagem de contratos

- `PaginatedResponse<T> { items, page, pageSize, total, totalPages }` corresponde ao envelope real do backend; listas não paginadas são arrays tipados; erros seguem `{ code, message }`.
- Tipos de domínio derivados dos DTOs/serviços NestJS e do schema Prisma (verificados no código do backend, não inventados): `Site`, `Building`, `Room`, `Rack`, `Device`, `DeviceModel`, `DeviceInterface`, `Vlan`, `Subnet`, `IpAddress`, `Host`, `Service`, `AssetFile`, `PortLayout`, `RackPlacementPlan`, `EffectiveAccess`, `AuditEvent`, `ApplicationLink`, etc.

### 4. React Query

- `QueryProvider` no layout raiz; server-state de todos os domínios migrou para `useQuery` com keys estáveis e por domínio:
  - `['infrastructure','sites'|'access',siteId|'locations',siteId|'racks',siteId|'device-models'|'assets'|'vlans',siteId|'devices',siteId,search|'interfaces',deviceId|'device',deviceId]`
  - `['ipam','network-map'|'subnets'|'subnet'|'usage'|'ips'|'host', …]` (partilha `['infrastructure','access',siteId]` e `['infrastructure','sites']` por serem os mesmos endpoints)
  - `['audit','events']`, `['dashboard','summary'|'health']`, `['profile','role-requests']`, `['portal','links',admin]`, `['setup','status']`, `['discovery','jobs'|'subnets'|'defaults'|'results']`
- Mutações/gestões mantêm o comportamento original (toasts, sincronização de URL, confirmações) e invalidam caches (`invalidateQueries`) em vez de re-fetch manuais.

### 5. Qualidade e tooling

- `@ts-nocheck`: **0** (antes 4 ficheiros); `any`: **0** (antes ~158 ocorrências).
- Alias de import `@/*` no `tsconfig.json`.
- Scripts novos em `apps/web/package.json`: `typecheck` (`tsc --noEmit`) e `lint` (ESLint 9 flat config com `next/core-web-vitals` + `next/typescript`).
- `next build` volta a correr lint (a regra `ignoreDuringBuilds` usada durante a migração foi removida).
- CI (`.github/workflows/ci.yml`): acrescentados gates de `typecheck` e `lint` do frontend; checks de backend intactos.
- `scripts/check-i18n.mjs` atualizado para os novos caminhos dos ficheiros.
- Adicionados `app/error.tsx` (boundary) e `app/not-found.tsx`.

## O que não mudou

- Rotas públicas (`/infraestrutura`, `/ipam`, `/auditoria`, `/definicoes`, …), contratos da API, permissões e regras de negócio.
- Traduções e o mecanismo de tradução DOM do dicionário `legacy-messages` (substituição futura, fora do âmbito).
- UX: nenhuma alteração visual; os diffs de JSX foram verificados (class names e markup idênticos).

## Validação executada

| Check | Comando | Resultado |
|---|---|---|
| TypeScript | `npm run typecheck --workspace=@simoes/web` | OK |
| Lint | `npm run lint --workspace=@simoes/web` | 0 erros (avisos pré-existentes de `exhaustive-deps` e `no-img-element`) |
| Build produção | `npm run build --workspace=@simoes/web` | OK — 14 rotas, com lint ativo no build |
| i18n | `npm run i18n:check` | OK — mesma cobertura (168 keyed / 414 legacy) |
| Testes | — | Não existem testes frontend (o spec desaconselha introduzir Vitest sem necessidade) |

## Follow-ups conhecidos

- Criar suite de testes frontend (Vitest + Testing Library) para os fluxos críticos (placement de equipamentos, IPAM, permissões).
- Mover o tipo `Site` (hoje em `features/infrastructure/types.ts` e importado por ipam/settings) para um pacote partilhado, se houver mais partilha entre domínios.
- Substituir a tradução DOM (`legacy-messages.ts`) por mensagens catalogadas nas features.
- Avisos de lint residuais: `exhaustive-deps` legados e `<img>` para assets autenticados (object URLs não são compatíveis com `next/image` sem loader customizado).
