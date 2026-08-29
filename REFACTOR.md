# Task: Refactor the Next.js Frontend to a Feature/Domain-Based Architecture

You are working on the following repository:

https://github.com/joaosimoes08/management-app

The frontend application is located at:

`apps/web`

Your task is to refactor the frontend from its current mostly horizontal structure into a **feature/domain-based architecture**, while preserving the existing behavior and user experience.

This is a structural and type-safety refactor. Do not redesign the product, change business behavior, or introduce unrelated features.

---

## Mandatory Git Workflow

Before changing any code, you **must create and switch to a new Git branch**.

Do not make changes directly on `main`, `master`, or the currently shared development branch.

Create a dedicated branch with a descriptive name, for example:

```bash
git checkout -b refactor/web-feature-domain-architecture
```

or, if the repository uses modern Git syntax:

```bash
git switch -c refactor/web-feature-domain-architecture
```

You must verify that you are on the new branch before making any modifications.

At the end of the task, report the exact branch name you created.

Do not merge the branch.

---

## Primary Goal

Refactor `apps/web` so that the application is organized by **business feature/domain**, instead of placing most application-specific code in large global folders such as `components/` and `lib/`.

The intended architectural principle is:

- `app/` is responsible primarily for Next.js routing, layouts, loading/error boundaries, route groups, and page composition.
- `features/` contains domain-specific frontend code.
- `components/` contains genuinely reusable/shared UI and application-shell components.
- `lib/` contains cross-cutting infrastructure such as authentication, API client code, i18n integration, query configuration, and generic utilities.
- Domain-specific types, API calls, hooks, utilities, constants, and components should live close to the feature that owns them.

A target structure may look similar to this:

```text
apps/web/
├── app/
│   ├── (authenticated)/
│   │   ├── infraestrutura/
│   │   │   └── page.tsx
│   │   ├── ipam/
│   │   │   └── page.tsx
│   │   ├── auditoria/
│   │   ├── definicoes/
│   │   └── ...
│   ├── layout.tsx
│   └── globals.css
│
├── features/
│   ├── infrastructure/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api/
│   │   ├── types/
│   │   ├── utils/
│   │   └── constants.ts
│   │
│   ├── ipam/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api/
│   │   ├── types/
│   │   └── utils/
│   │
│   ├── audit/
│   ├── settings/
│   └── ...
│
├── components/
│   ├── ui/
│   └── layout/
│
├── lib/
│   ├── auth/
│   ├── api/
│   ├── i18n/
│   └── query/
│
└── types/
```

This structure is a guideline, not a requirement to reproduce the exact folder names mechanically. Use the existing application domains and codebase to determine the cleanest final organization.

---

# Required Refactor Scope

## 1. Remove all `@ts-nocheck`

Find every occurrence of:

```ts
// @ts-nocheck
```

inside `apps/web`.

Remove all of them.

Do not simply replace them with other mechanisms that disable type checking globally.

Do not use the following as shortcuts unless absolutely unavoidable and explicitly justified:

```ts
// @ts-ignore
// @ts-expect-error
```

The desired result is that the frontend is genuinely type-safe.

After removing `@ts-nocheck`, fix the underlying TypeScript errors properly.

---

## 2. Create Domain-Specific Interfaces and Types

Identify the major frontend business domains, including at minimum the domains already represented by routes/components such as:

- Infrastructure
- IPAM
- Audit
- Settings
- Authentication, where applicable
- Other business domains that already exist in the application

Move or create types close to the feature that owns them.

For example:

```text
features/infrastructure/types/
features/ipam/types/
```

or:

```text
features/infrastructure/types.ts
features/ipam/types.ts
```

Choose the approach that best fits the size of each domain.

Create explicit TypeScript types/interfaces for entities and UI models such as, where relevant:

```ts
Site
Room
Rack
RackUnit
Device
DevicePlacement
EquipmentType
Subnet
IPAddress
VLAN
AuditEvent
User
Role
Permission
Pagination
APIError
```

These names are examples. Inspect the actual API responses and existing usage before defining the final models.

Do not invent fields that do not exist.

Prefer types derived from the actual backend contract.

Avoid giant global type files containing unrelated domains.

---

## 3. Replace `any` with Concrete Types

Search the entire `apps/web` application for explicit and implicit uses of `any`.

Examples include:

```ts
function Modal(props: any)
```

```ts
function CalculatorView({ calc, setCalc, result, onSubmit }: any)
```

```ts
const data: any = ...
```

```ts
apiFetch<any>(...)
```

Replace them with concrete, meaningful TypeScript types.

For React components, create proper props interfaces:

```ts
interface ModalProps {
  title: string;
  children: React.ReactNode;
  close: () => void;
}
```

Do not replace `any` mechanically with `unknown` unless `unknown` is genuinely the correct type.

If external data is initially unknown, narrow it before use.

Avoid type assertions such as:

```ts
value as SomeType
```

unless the assertion is safe and justified.

Prefer actual type inference, validation, narrowing, or typed API functions.

---

## 4. Type All API Responses

The frontend currently uses API calls in multiple places.

Create a clear, typed API layer.

Avoid having components directly make loosely typed requests such as:

```ts
const data = await apiFetch(...)
```

without a known response type.

Each API function should have a defined input and output contract.

For example:

```ts
export async function getRacks(siteId: string): Promise<Rack[]> {
  return apiFetch<Rack[]>(`/racks?siteId=${siteId}`);
}
```

Or, when the API wraps responses:

```ts
interface GetRacksResponse {
  items: Rack[];
  total: number;
}

export async function getRacks(
  siteId: string
): Promise<GetRacksResponse> {
  ...
}
```

Inspect the backend implementation before creating response types.

Do not guess API contracts.

Where appropriate, introduce reusable generic types such as:

```ts
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

only if this matches the actual API behavior.

API functions should live inside either:

```text
features/<domain>/api/
```

for domain-specific endpoints, or:

```text
lib/api/
```

for generic API transport infrastructure.

---

# Architecture Requirements

## Keep `app/` Thin

Pages inside the Next.js App Router should primarily compose feature-level components.

A page like:

```tsx
export default function InfrastructurePage() {
  return <InfrastructureWorkspace />;
}
```

is desirable.

Large amounts of domain logic should not live directly in:

```text
app/**/page.tsx
```

Move domain-specific state, API interaction, transformations, and UI implementation into the relevant feature.

---

## Introduce a `features/` Directory

Create:

```text
apps/web/features/
```

Organize frontend business logic by domain.

For example:

```text
features/infrastructure/
features/ipam/
features/audit/
features/settings/
```

A feature may contain:

```text
components/
hooks/
api/
types/
utils/
constants/
```

Only create folders that are actually useful.

Do not create empty architectural boilerplate.

---

## Refactor the Infrastructure Domain First

The infrastructure area is currently one of the largest and most complex parts of the frontend and should be treated as the main reference implementation for this architecture.

In particular, inspect large files such as the current infrastructure workspace implementation.

Do not leave a multi-thousand-line "god component" untouched merely inside a new directory.

Break it into cohesive units.

Possible conceptual areas include:

```text
features/infrastructure/components/racks/
features/infrastructure/components/devices/
features/infrastructure/components/sites/
features/infrastructure/components/rooms/
```

Potential component responsibilities may include:

- Infrastructure workspace orchestration
- Rack view
- Rack grid
- Rack unit
- Device placement
- Device editor/details
- Unpositioned devices
- Site tree
- Site selector
- Room-related components

Do not split files arbitrarily.

Each extracted component or hook should have a clear responsibility.

---

## Extract Domain Hooks Where Appropriate

Move reusable domain behavior out of giant components.

Examples may include hooks such as:

```ts
useRacks(...)
useDevices(...)
useSites(...)
useDevicePlacement(...)
useSubnets(...)
```

Only introduce a hook when it represents reusable or cohesive React behavior.

Do not create hooks merely to move code from one file to another.

---

## Use React Query Consistently Where It Already Makes Sense

The project already includes React Query.

Prefer React Query for server-state concerns such as:

- fetching
- caching
- refetching
- loading state
- server errors
- mutations
- cache invalidation

Avoid unnecessarily managing remote server state using repetitive combinations of:

```ts
useEffect
useState
loading
error
apiFetch
```

when React Query is the appropriate tool.

Do not force React Query onto purely local UI state.

Use stable and domain-specific query keys.

For example:

```ts
['infrastructure', 'racks', siteId]
```

instead of vague keys.

---

# API and Authentication Separation

Review the current authentication provider and API-fetching responsibilities.

If the auth context exposes a generic HTTP client such as:

```ts
apiFetch<T>()
```

refactor this so authentication and HTTP transport concerns are clearly separated.

A preferred conceptual structure is:

```text
lib/
├── auth/
│   ├── auth-provider.tsx
│   ├── use-auth.ts
│   ├── keycloak.ts
│   └── types.ts
│
└── api/
    ├── client.ts
    ├── errors.ts
    └── types.ts
```

The authentication layer may provide credentials/token information needed by the API client, but the auth provider should not become a general service container for every backend call.

Preserve the existing authentication behavior.

Do not break Keycloak integration or session handling.

---

# Shared Components

Review the current global `components/` directory.

Move domain-specific components into their domain.

Keep only truly reusable components in shared locations.

For example:

```text
components/ui/
```

for generic controls such as:

- Button
- Modal/Dialog
- Input
- Select
- Table
- Badge
- Tooltip

and:

```text
components/layout/
```

for global application layout concerns such as:

- AppShell
- Sidebar
- Header
- Navigation
- User menu
- Global search
- Notifications UI

A component should not remain global simply because multiple files import it.

It should be global only when its responsibility is genuinely cross-domain.

---

# Refactor the App Shell

Review `AppShell` and related components.

If a single component currently owns navigation configuration, authentication state, i18n behavior, search, sidebar behavior, user actions, and visual rendering, split it into cohesive pieces.

A reasonable result may resemble:

```text
components/layout/
├── app-shell.tsx
├── app-sidebar.tsx
├── app-header.tsx
├── navigation.ts
├── user-menu.tsx
├── global-search.tsx
└── notifications-menu.tsx
```

Use the actual existing behavior to determine what should be extracted.

Do not introduce unnecessary abstraction.

---

# Next.js App Router Improvements

Review whether route groups and layouts can reduce repeated shell/authentication code.

For example, consider a structure such as:

```text
app/
├── (authenticated)/
│   ├── layout.tsx
│   ├── infraestrutura/
│   ├── ipam/
│   ├── auditoria/
│   └── definicoes/
│
├── (public)/
│   └── ...
│
└── layout.tsx
```

Use this only if it improves the current application.

Preserve the public URLs.

A route group must not accidentally change routes such as:

```text
/infraestrutura
/ipam
/auditoria
/definicoes
```

Also inspect whether the application would benefit from appropriate:

```text
loading.tsx
error.tsx
not-found.tsx
```

Do not add them purely for appearance; add them where they provide useful behavior.

---

# Remove Temporary or Legacy Naming

Review files with temporary migration names such as:

```text
*-next.tsx
*-new.tsx
*-v2.tsx
legacy-*
```

If the newer implementation is the canonical implementation, rename it to the proper final name and remove obsolete code when safe.

For example:

```text
infrastructure-workspace-next.tsx
```

should not remain permanently named `-next` if it is the active implementation.

Before deleting old code, verify that it is unused.

Git history already preserves deleted implementations.

---

# Preserve Existing Behavior

This refactor must not intentionally alter:

- routes
- API contracts
- authentication behavior
- permissions
- business rules
- UI workflows
- translations
- user-visible features

Do not perform a visual redesign.

Do not introduce a new component library.

Do not migrate to a different state management library.

Do not rewrite unrelated backend code.

Changes to the backend should only be made if required to accurately expose or share types, and only when clearly justified.

---

# TypeScript Standards

The frontend should continue to use strict TypeScript.

The final code should avoid:

```ts
any
@ts-nocheck
@ts-ignore
```

Use discriminated unions where they make domain states clearer.

Use `unknown` for genuinely unknown external input and narrow it safely.

Prefer:

```ts
type DeviceStatus = 'online' | 'offline' | 'maintenance';
```

over loosely typed strings when the allowed values are known.

Prefer explicit nullable types:

```ts
Room | null
```

rather than relying on undefined behavior.

Component props, hook return values, API inputs, and API outputs should be typed.

---

# Validation and Runtime Data

TypeScript types do not validate runtime HTTP responses.

If the project already uses a runtime validation library, use it where appropriate.

If it does not, do not add a large dependency solely for this refactor unless there is a clear need.

At minimum:

- type the known API contracts correctly;
- handle nullable and optional backend fields explicitly;
- do not silently assume fields always exist when the backend marks them optional.

---

# Quality Gates

Before considering the task complete, run the appropriate checks for the frontend and repository.

At minimum, run:

```bash
npm run build --workspace=@simoes/web
```

If the workspace name differs, inspect `package.json` and use the correct workspace command.

Also run TypeScript checking explicitly.

If there is no existing script, add one such as:

```json
"typecheck": "tsc --noEmit"
```

and run it.

Add or improve frontend scripts where appropriate:

```json
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "next build"
  }
}
```

Do not blindly add Vitest if there is no testing setup and doing so would create unnecessary scope. If frontend tests already exist, run them.

Run all existing relevant repository checks, including i18n validation if present.

The final state must not rely on `@ts-nocheck` to compile.

---

# CI Improvements

Review the existing CI configuration.

If the frontend does not currently have explicit quality gates, update CI so that appropriate frontend checks run automatically.

At minimum, CI should verify:

```text
TypeScript
Build
Lint
```

where supported by the project.

If frontend tests already exist or are introduced as part of this refactor, include them as well.

Do not weaken existing backend CI checks.

---

# Migration Strategy

Do not attempt a blind repository-wide file move followed by fixing hundreds of broken imports.

Use an incremental strategy.

Recommended order:

1. Create and switch to the new Git branch.
2. Inspect the current frontend structure and dependencies.
3. Identify shared vs domain-specific code.
4. Create the new feature/domain structure.
5. Refactor the Infrastructure domain first.
6. Remove `@ts-nocheck` from that domain and fix all resulting types.
7. Introduce typed Infrastructure API functions and React Query hooks where appropriate.
8. Refactor IPAM using the same principles.
9. Refactor the remaining domains.
10. Separate shared layout, auth, API transport, and generic UI.
11. Remove obsolete/duplicate implementations.
12. Fix all imports.
13. Search globally for remaining `@ts-nocheck` and `any`.
14. Run typecheck, lint, tests, i18n checks, and builds.
15. Review the final diff for accidental behavior changes.

Commit in logical units if appropriate.

Example commit grouping:

```text
refactor(web): introduce feature-based frontend structure
refactor(web): split infrastructure domain
refactor(web): add typed domain API layer
refactor(web): remove ts-nocheck and any usage
refactor(web): reorganize shared layout and auth
ci(web): add frontend typecheck and lint gates
```

Do not create meaningless commits for individual file moves.

---

# Important Constraints

Do not:

- make changes directly on the main/shared branch;
- disable strict TypeScript;
- solve errors by adding `any`;
- add `@ts-nocheck`;
- broadly use `@ts-ignore`;
- redesign the UI;
- change public routes;
- change business logic without necessity;
- rewrite the backend unnecessarily;
- rename API fields merely to make frontend types nicer;
- introduce architectural abstractions with no current use;
- create empty folders just to match a template;
- leave old and new implementations duplicated indefinitely.

---

# Completion Criteria

The refactor is complete only when all of the following are true:

- A new Git branch was created before modifications.
- The frontend has a clear feature/domain-based structure.
- `app/` is primarily responsible for routing and composition.
- Infrastructure-specific implementation is located under an Infrastructure feature.
- IPAM-specific implementation is located under an IPAM feature.
- Other domain code follows the same principle where appropriate.
- Shared components are clearly separated from domain components.
- API transport is separated from authentication concerns.
- API responses are explicitly typed.
- Domain entities have proper TypeScript interfaces/types.
- Explicit `any` usage has been removed wherever reasonably possible.
- All `@ts-nocheck` directives in `apps/web` are removed.
- No new `@ts-nocheck` directives were added.
- Active files no longer use temporary names such as `-next` when unnecessary.
- Existing routes and behavior remain intact.
- TypeScript checking passes.
- The Next.js production build passes.
- Existing relevant tests/checks pass.
- CI is not weakened.

---

# Final Report

When finished, provide a concise implementation report containing:

1. The exact Git branch created.
2. A summary of the architectural changes.
3. The final high-level directory structure of `apps/web`.
4. The main large components that were split.
5. The domain types/interfaces that were introduced.
6. How API response typing was implemented.
7. How authentication and API transport responsibilities were separated, if changed.
8. All remaining occurrences of `any`, if any, with justification for each.
9. Confirmation that there are zero remaining `@ts-nocheck` occurrences in `apps/web`.
10. Commands executed for validation.
11. The result of typecheck, lint, tests, i18n checks, and production build.
12. Any risks, follow-up work, or intentionally deferred improvements.

Do not claim that a check passed unless you actually ran it.

Do not merge the branch.

