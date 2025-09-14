# Repository Guidelines

## Project Structure & Module Organization
- `.github/workflows/` — reusable and local workflows (e.g., `test.yml`, `sync-obsidian-blog.yml`).
- `composite/<name>/action.yml` — composite actions with their steps and env handling (e.g., `composite/setup-utils/action.yml`).
- `actions/*.yml` — action interfaces or metadata stubs (e.g., `actions/send-notification.yml`).
- `scripts/` — helper shell scripts invoked by actions (e.g., `scripts/test.sh`).

## Build, Test, and Development Commands
- Validate YAML schemas in-editor via `yaml-language-server` hints present in files.
- Lint YAML: `yamllint .` (optional, recommended).
- Lint shell: `shellcheck scripts/*.sh`.
- Local run (optional): `act -W .github/workflows/test.yml -j test1` to exercise a job.

## Coding Style & Naming Conventions
- YAML: 2-space indent, kebab-case keys, no trailing whitespace; file names kebab-case (`send-notification.yml`).
- Bash: shebang `#!/usr/bin/env bash`, `set -euo pipefail`, prefer long flags, quote vars (`"$VAR"`).
- Env vars: UPPER_SNAKE_CASE; inputs/outputs: kebab-case in YAML.
- Paths: keep composite actions under `composite/<action>/action.yml`; keep shared scripts in `scripts/` and mark executable (`chmod +x`).

## Testing Guidelines
- Add a targeted workflow under `.github/workflows/` to exercise new actions.
- Use `workflow_dispatch` for manual runs; prefer minimal jobs and clear assertions.
- Keep test logs concise; avoid echoing secrets. Aim for meaningful step names.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`); scope when helpful (`chore(actions): …`).
- PRs: include purpose, example usage (`uses: zdpk/actions/<action>@<ref>`), and links to related issues. Add before/after logs or screenshots when relevant.
- Keep changes focused; update or add a workflow example when introducing a new action.

## Security & Configuration Tips
- Never commit secrets; consume via `secrets.*` and minimize `permissions` in workflows.
- Do not print tokens; mask sensitive output and avoid `set -x` in secret-bearing steps.
- Pin third-party actions to a tag or SHA where possible.
