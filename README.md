# Personal PM Agent

Personal PM Agent is a local-first CLI for maintaining a private project progress ledger.

Personal PM Agent focuses on:

- creating a progress ledger structure
- collecting project, task, log, people, and repository context
- generating `context-raw.json`, `context-pack.json`, `pm-report.json`, daily reports, share drafts, and ledger suggestions
- analyzing estimated and actual task time from daily logs

## Commands

```sh
npm install
npm run build
npm run pm-agent -- setup
npm run pm-agent -- init ../progress-ledger
npm run pm-agent -- morning ../progress-ledger
npm run pm-agent -- dashboard ../progress-ledger
npm run pm-agent -- understand ../your-project-repo
```

Daily use after setup:

```sh
npm start
npm run dashboard
```

`npm start` opens the interactive shell for `../progress-ledger`. This is the short form of `node dist/cli.js shell ../progress-ledger`.

`setup` is the recommended first run after cloning this repository. It checks `gh auth status`, creates a private `progress-ledger` GitHub repository when missing, clones or reuses `../progress-ledger`, initializes the ledger structure, commits it, and pushes it.

Setup options:

```sh
npm run pm-agent -- setup
npm run pm-agent -- setup ../my-ledger --ledger-name my-ledger --private
npm run pm-agent -- setup ../my-ledger --ledger-name my-ledger --public
npm run pm-agent -- setup ../progress-ledger --owner github-user
npm run pm-agent -- setup ../progress-ledger --select-repos --repo-scope all
npm run pm-agent -- setup ../progress-ledger --select-repos --repo-scope owned
npm run pm-agent -- setup ../progress-ledger --select-repos --repo-scope collaborating
npm run pm-agent -- setup ../progress-ledger --no-github
```

`--select-repos` lists repositories visible to the authenticated GitHub account before reading README files or adding repo context. Only selected repositories are registered in `links/repositories.md` and `context/repositories.md`. Use `--repo-scope owned`, `--repo-scope collaborating`, or `--repo-scope all`.

GitHub setup requires the GitHub CLI:

```sh
gh auth login
```

`morning` uses JST (`Asia/Tokyo`) for the default date. You can override it:

```sh
npm run pm-agent -- morning ../progress-ledger --date 2026-05-18
```

Task operations:

```sh
npm run pm-agent -- task ../progress-ledger add --list active --title "Progress Ledger構成図のラフを作る"
npm run pm-agent -- task ../progress-ledger move --from active --to done --title "Progress Ledger構成図のラフを作る"
npm run pm-agent -- task ../progress-ledger list --list active
npm run pm-agent -- task ../progress-ledger discover --repo personal-pm-agent
npm run pm-agent -- task ../progress-ledger discover --source github --repo personal-pm-agent
npm run pm-agent -- task ../progress-ledger discover --source github --repo study-forge
npm run pm-agent -- task ../progress-ledger discover --source github
npm run pm-agent -- task ../progress-ledger discover --source github --scope all
npm run pm-agent -- task ../progress-ledger import --number 1 --list active
```

`task discover` writes selectable candidates to `tasks/candidates.json` and keeps that file out of Git by default. The default source is `local`, which scans local Git status and TODO comments for repositories in `links/repositories.md`. Use `--source github` to scan open GitHub Issues and PRs through the authenticated `gh` CLI. GitHub discovery can target a repo from `links/repositories.md`, a repo name in your GitHub account, or all repos in your account when `--repo` is omitted. GitHub discovery defaults to `--scope mine`: issues assigned to you, PRs authored by you, and PRs requesting your review. Use `--scope all` only when you want collaborator-owned open work too.

Interactive shell:

```sh
npm start
```

Then use short commands:

```txt
/status
/morning
/dashboard daily
/dashboard tasks
/dashboard repositories
/tasks active
/discover personal-pm-agent
/discover github personal-pm-agent
/discover github study-forge
/discover github
/discover github --scope all
/split-issue study-forge 12
/split-issue study-forge 12 --apply
/import 1 --list active
/add "Progress Ledger構成図のラフを作る" --list active
/add "READMEの導入を直す" --list active --repo study-forge
/exit
```

Issue splitting is dry-run by default. It reads the parent Issue from GitHub, uses unchecked checklist items as child Issue titles when available, and falls back to a basic requirement/design/implementation/verification split. Add `--apply` only when you want to create the child Issues on GitHub.

In the interactive shell, `/report`, `/share`, and `/suggest` open the dashboard automatically on the matching tab and also print the generated file path. Use `--no-open` when you only want to generate the file:

```txt
/report --no-open
/share --no-open
/suggest --no-open
```

Outside the shell, pass `--open` when you want the generated Markdown file to open automatically:

```sh
npm run pm-agent -- report ../progress-ledger --open
npm run pm-agent -- share ../progress-ledger --open
npm run pm-agent -- suggest ../progress-ledger --open
```

Dashboard:

```sh
npm run pm-agent -- dashboard ../progress-ledger
npm run pm-agent -- dashboard ../progress-ledger --port 4790
npm run pm-agent -- dashboard ../progress-ledger --no-open
```

The dashboard is a local-only browser UI for reading the ledger. It shows status, daily reports, share drafts, suggestions, task lists, repository context, repository links, and generated file lists from the selected date. Repository details can be opened by URL, for example `?tab=repositories&repo=study-forge`.

Repository understanding:

```sh
npm run pm-agent -- understand ../study-forge
npm run pm-agent -- understand ../study-forge --refresh
npm run pm-agent -- understand ../study-forge --budget cheap
npm run pm-agent -- understand ../study-forge --budget deep
npm run pm-agent -- understand-active ../progress-ledger --refresh
```

`understand` reads git-tracked files only, applies `.pm-agentignore`, scans and redacts secret-like values, and writes a local project knowledge base under the target repository:

- `.pm-agent/catalog/file-cards.json`
- `.pm-agent/graph/dependency-graph.json`
- `.pm-agent/graph/reverse-dependency-index.json`
- `.pm-agent/file-summaries/`
- `.pm-agent/project/project-brief.md`
- `.pm-agent/project/area-map.md`
- `.pm-agent/project/capability-map.md`
- `.pm-agent/project/capability-map.json`
- `.pm-agent/project/issue-map.md`
- `.pm-agent/project/issue-map.json`
- `.pm-agent/safety/safety-report.md`

What `understand` reads:

- files returned by `git ls-files`
- files not excluded by `.pm-agentignore`
- head excerpts, imports, exports, symbols, markdown headings, and package metadata
- selected deep-read files after safety filtering and token budget trimming

`--budget cheap|standard|deep` controls how many files are selected for deep read and how much token budget is used. `standard` is the default. `cheap` keeps the knowledge base smaller for quick setup, while `deep` reads more important files for planning.

`.pm-agentignore` is separate from `.gitignore`. It is created automatically when missing and excludes common secret, dependency, build, generated, and large-file paths such as `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, `service-account*.json`, `secrets/`, `node_modules/`, `dist/`, `build/`, `coverage/`, lock files, maps, database dumps, and archives.

Safety and Secret Redaction:

- danger paths are handled as `skip`, `structure-only`, or `redact`
- `.env` and private key files are skipped by default
- `.env.example` style files are still secret-scanned and redacted when included
- config files such as `src/config/env.ts` are treated as structure-only by default when matched
- LLM payloads are audited immediately before use; secret-like values are redacted or the payload is blocked
- Safety reports are written to `.pm-agent/safety/safety-report.md` and `.pm-agent/safety/safety-report.json`

Redacted patterns include OpenAI API keys, GitHub tokens, Slack tokens, AWS access keys, private keys, database URLs, `*_SECRET`, `*_TOKEN`, and `*_PASSWORD` values.

User approval allows scanning. User approval does not bypass redaction.

ユーザーの許可はスキャン対象に含めるための許可であり、secretをLLMへそのまま送る許可ではありません。

Redaction is a safety layer, not a formal guarantee. Review the Safety Report before using generated summaries for planning or model input.

To understand only active repositories registered in the ledger:

```sh
npm run pm-agent -- understand-active ../progress-ledger
npm run pm-agent -- understand-active ../progress-ledger --refresh
npm run pm-agent -- understand-active ../progress-ledger --no-github
```

Active repositories are detected from explicit repository activation, `tasks/active.md` entries with `<!-- repo:<repo-id> -->`, and, unless `--no-github` is passed, registered repositories that have open GitHub Issues assigned to you.

To activate a repository even when it has no Issue yet:

```sh
npm run pm-agent -- repo ../progress-ledger activate --repo study-forge
npm run pm-agent -- repo ../progress-ledger active
npm run pm-agent -- understand-active ../progress-ledger
```

In the shell:

```txt
/activate-repo study-forge
/active-repos
/understand-active
```

Explicitly active repositories are stored in `context/active-repositories.md`.

`understand-active` does not clone repositories. For each active repository it resolves the local repository in this order:

- `path:` in `links/repositories.md`
- a sibling directory of the ledger with the same repo id
- directories under `PM_AGENT_REPO_ROOTS`, the ledger parent, `~/work`, and the current working directory

If no local clone is found but `github: owner/name` is registered, it generates a lightweight GitHub remote context instead:

- `.pm-agent/remote-repositories/<repo-id>/project/project-brief.md`
- `.pm-agent/remote-repositories/<repo-id>/project/area-map.md`
- `.pm-agent/remote-repositories/<repo-id>/project/capability-map.md`
- `.pm-agent/remote-repositories/<repo-id>/project/issue-map.md`
- `.pm-agent/remote-repositories/<repo-id>/project/repository-context.json`
- `.pm-agent/remote-repositories/<repo-id>/safety/safety-report.md`

Remote context uses GitHub repository metadata, README, and open Issues assigned to you. It does not read local files, so file cards, dependency graphs, and deep implementation summaries are only available when a local clone is found.

The default adapter is `mock`, so the MVP flow can be tested without an API contract.
To use a background terminal agent, configure `pm-agent.config.json` in the ledger and run:

```sh
npm run pm-agent -- morning ../progress-ledger --adapter background-agent
```

The generated report contract is file-based:

- input: `ai/outputs/YYYY-MM-DD/context-pack.json`
- schema: `ai/schemas/pm-report.schema.json`
- output: `ai/outputs/YYYY-MM-DD/pm-report.json`
- local logs: `ai/outputs/YYYY-MM-DD/agent-run.log`

`agent-run.log` is local diagnostic output and should usually be ignored by Git.

## Daily Time Entries

Add actual work time to `logs/daily/YYYY-MM-DD.md`:

```md
## Time Entries

- task: Output Contract整理
  category: planning
  actual_minutes: 90
  notes: Validator条件と出力契約を整理
```

Supported categories are stable labels such as `planning`, `design`, `implementation`, `writing`, `review`, `communication`, `research`, `operations`, and `decision`.

## Config

`pm-agent.config.json` controls collection and agent logs:

```json
{
  "collect": {
    "projects": { "enabled": true },
    "tasks": { "enabled": true },
    "dailyLogs": { "enabled": true, "days": 7 },
    "people": { "enabled": true },
    "repositories": { "enabled": true, "includeGitStatus": true },
    "previousReport": { "enabled": true }
  },
  "agentLogs": {
    "save": true,
    "gitIgnore": true
  }
}
```

## Repository Roles

- `personal-pm-agent`: CLI and agent implementation
- `progress-ledger`: private progress ledger data
