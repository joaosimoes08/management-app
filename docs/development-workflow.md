# Development workflow: git worktrees

Notes for engineers and coding agents working on the Management-App monorepo. Every branch gets its
own git worktree under a single worktrees root; there are no other copies of the repository.

Placeholders used below:

- `<repo-root>`: the main checkout of the repository.
- `<worktrees-root>`: the one folder that holds every worktree.
- `<branch-slug>`: the branch name with `/` replaced by `-` (`feature/foo-bar` becomes
  `feature-foo-bar`).

## 1. Create a worktree

One worktree per branch, created from the main checkout and never from a clone:

```sh
git -C <repo-root> fetch origin
git -C <repo-root> worktree add -b <branch> <worktrees-root>/<branch-slug> origin/main
```

- Do not `git clone` the repository again, and do not create copies of it next to `<repo-root>`,
  in temporary directories or anywhere outside `<worktrees-root>`.
- Do not delete, reset, clean or switch branches in `<repo-root>`: it may hold someone's own
  uncommitted work and running dev services. Do all branch work in your worktree.

## 2. Install dependencies

The repository uses npm. Inside the worktree run:

```sh
npm ci
```

Use `npm install` only when you deliberately change dependencies, and commit the updated
`package-lock.json` with that change. Docs-only branches usually do not need `node_modules` at all.

## 3. Clean up after merge

Remove a worktree only when all of these are true:

- the PR is merged;
- the tree is clean (`git -C <worktrees-root>/<branch-slug> status --porcelain` prints nothing);
- every commit is pushed to GitHub.

Then run:

```sh
git -C <repo-root> worktree remove <worktrees-root>/<branch-slug>
git -C <repo-root> branch -D <branch>
```

`git worktree remove` deletes the folder together with its `node_modules` and build output, so a
finished worktree costs no disk. Never use `--force`: if `worktree remove` refuses (uncommitted or
untracked changes), stop and report it instead of forcing it. Bulk or historical cleanups of old
worktrees and branches need the repository owner's approval first.

## 4. Stopping processes

Dev services from `<repo-root>` and test processes from other worktrees can run on the same machine.
Stop your own test processes only by PID, or with `pkill -f` patterns that include your own
worktree's absolute path (`<worktrees-root>/<branch-slug>`). Never use a bare pattern such as a
script or file name that other checkouts share.

## Pull requests

Titles use `feature/<what this PR does>` or `fix/<what this PR fixes>`.
