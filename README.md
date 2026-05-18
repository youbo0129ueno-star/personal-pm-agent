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
npm run pm-agent -- setup ../progress-ledger --no-github
```

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
npm run pm-agent -- task ../progress-ledger import --number 1 --list active
```

`task discover` writes selectable candidates to `tasks/candidates.json` and keeps that file out of Git by default. The default source is `local`, which scans local Git status and TODO comments for repositories in `links/repositories.md`. Use `--source github` to scan open GitHub Issues and PRs through the authenticated `gh` CLI. GitHub discovery can target a repo from `links/repositories.md`, a repo name in your GitHub account, or all repos in your account when `--repo` is omitted.

Interactive shell:

```sh
npm start
```

Then use short commands:

```txt
/status
/morning
/tasks active
/discover personal-pm-agent
/discover github personal-pm-agent
/discover github study-forge
/discover github
/import 1 --list active
/add "Progress Ledger構成図のラフを作る" --list active
/add "READMEの導入を直す" --list active --repo study-forge
/exit
```

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

The dashboard is a local-only browser UI for reading the ledger. It shows status, daily reports, share drafts, suggestions, task lists, and generated file lists from the selected date.

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
