# Development workflow: pnpm, worktrees and dependencies

Notes for engineers and coding agents working on the Management-App monorepo. `AGENTS.md` is
gitignored in this repository (each checkout keeps its own local copy), so the shared rules live here;
local `AGENTS.md` files should point to this page.

## Package manager

The repository uses **pnpm** workspaces (`apps/*`, `packages/*`, see `pnpm-workspace.yaml`). The pnpm
version is pinned by `"packageManager"` in the root `package.json`; run `corepack enable` once and
corepack provides that version. Do not use `npm install`, `npm ci` or `npx` in this repository, and
do not commit a `package-lock.json` at the root.

The one exception is `apps/snmp/runtime/package-lock.json`: the SNMP image's runtime stage installs
only those production packages with `npm ci` inside Docker. Leave it as npm.

pnpm uses a strict `node_modules` layout: a package can only import what its own `package.json`
declares. If an import works for one app but not another, add the dependency to the package that
imports it. Scripts in the root `scripts/` folder use the root `package.json` devDependencies.

## Common commands

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install --frozen-lockfile` |
| Generate Prisma client | `pnpm db:generate` |
| Apply migrations (dev / deploy) | `pnpm db:migrate:dev` / `pnpm db:migrate` |
| Build everything | `pnpm build` |
| Start API (watch) / worker / web | `pnpm start:dev` / `pnpm worker:dev` / `pnpm web:dev` |
| Check translations | `pnpm i18n:check` |
| Web typecheck / lint / tests | `pnpm --filter @simoes/web typecheck` / `lint` / `test` |
| Backend typecheck | `pnpm --filter @simoes/api exec tsc -p tsconfig.json --noEmit` (same for `@simoes/snmp`, `@simoes/snmp-core`) |
| Unit tests | `pnpm --filter @simoes/snmp-core test`, `pnpm --filter @simoes/api test`, `pnpm --filter @simoes/snmp test` |
| HTTP integration tests | `pnpm test:http` |
| Run any workspace script | `pnpm --filter @simoes/<package> <script>` |
| Add a dependency | `pnpm --filter @simoes/<package> add <dep>` (internal packages use `"workspace:*"`) |

## Worktrees and dependencies

Approved by Joao on 2026-11-25. Every branch gets its own git worktree; there are no other copies of
the repository.

1. **Create** a worktree from the main checkout, never a clone:
   ```sh
   git -C /Users/joao/projects/MGMT-APP fetch origin
   git -C /Users/joao/projects/MGMT-APP worktree add -b <branch> /Users/joao/projects/worktrees/<branch-slug> origin/main
   ```
   `<branch-slug>` is the branch name with `/` replaced by `-` (`feature/foo-bar` becomes
   `feature-foo-bar`). Do not create `~/projects/MGMT-APP-*` folders, `/tmp` copies or worktrees in
   bot task folders.
2. **Dependencies:** run `pnpm install --frozen-lockfile` inside the worktree. pnpm keeps one global
   content-addressed store and hard-links packages into each worktree, so extra worktrees cost little
   disk. Never run `npm install` or `npm ci`. A branch cut from a main older than the pnpm migration
   only has `package-lock.json`; use `npm ci` once there and say so in the PR.
3. **Clean up after merge:** when the PR is merged, `git status --porcelain` is empty and every
   commit is on GitHub, run
   ```sh
   git -C /Users/joao/projects/MGMT-APP worktree remove /Users/joao/projects/worktrees/<branch-slug>
   git -C /Users/joao/projects/MGMT-APP branch -D <branch>
   ```
   and report the removal. Bulk or historical cleanups need Joao's approval first.
4. **Never** delete, reset, clean or switch branches in `/Users/joao/projects/MGMT-APP`: it holds
   Joao's own uncommitted work and serves `http://localhost:3000`.
5. **Processes:** Joao's dev services run on the same machine. Stop test processes only by PID or
   with `pkill -f` patterns that include your own worktree's absolute path.

Full rules: `/Users/joao/projects/worktrees/README.md`.

## Pull requests

Titles use `feature/<what this PR does>` or `fix/<what this PR fixes>`.
