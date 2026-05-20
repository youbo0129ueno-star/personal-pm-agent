#!/usr/bin/env node
import { collectCommand } from "./commands/collect.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { initCommand } from "./commands/init.js";
import { morningCommand } from "./commands/morning.js";
import { reportCommand } from "./commands/report.js";
import { repositoryCommand } from "./commands/repository.js";
import { shareCommand } from "./commands/share.js";
import { setupCommand } from "./commands/setup.js";
import { suggestCommand } from "./commands/suggest.js";
import { taskCommand } from "./commands/task.js";
import { understandActiveCommand } from "./commands/understand-active.js";
import { understandCommand } from "./commands/understand.js";
import { assertDateString } from "./core/date.js";
import { resolveTarget } from "./core/fs.js";
import { openFile } from "./core/open.js";
import { startShell } from "./shell.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const parsed = parseArgs(args);
  const targetDir = resolveTarget(parsed.target);

  if (!command || command === "shell") {
    await startShell(resolveTarget(command === "shell" ? parsed.target : parsed.target ?? "../progress-ledger"));
    return;
  }

  if (command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    await initCommand(targetDir);
    console.log(`Initialized progress ledger: ${targetDir}`);
    return;
  }

  if (command === "setup") {
    const setupTargetDir = resolveTarget(parsed.target ?? "../progress-ledger");
    const message = await setupCommand(setupTargetDir, parsed.options);
    console.log(message);
    return;
  }

  if (command === "collect") {
    await collectCommand(targetDir);
    console.log(`Collected context: ${targetDir}`);
    return;
  }

  if (command === "dashboard") {
    const message = await dashboardCommand(targetDir, parsed.options);
    console.log(message);
    return;
  }

  if (command === "understand") {
    const message = await understandCommand(targetDir, parsed.options);
    console.log(`${message}

Next:
1. Review the brief: ${targetDir}/.pm-agent/project/project-brief.md
2. Review the area map: ${targetDir}/.pm-agent/project/area-map.md
3. Review safety findings: ${targetDir}/.pm-agent/safety/safety-report.md
4. Rebuild with --refresh when the repository changes significantly.`);
    return;
  }

  if (command === "understand-active") {
    const message = await understandActiveCommand(targetDir, parsed.options);
    console.log(`${message}

Next:
1. Open the dashboard: pm-agent dashboard ${targetDir}
2. View active repo details in Repositories.
3. Run with --refresh after larger repo changes.`);
    return;
  }

  if (command === "report") {
    const result = await reportCommand(targetDir, parsed.options);
    await maybeOpen(parsed.options.open, result.markdownPath);
    console.log(`Generated PM report:\n- Markdown: ${result.markdownPath}\n- JSON: ${result.jsonPath}`);
    return;
  }

  if (command === "share") {
    const result = await shareCommand(targetDir, parsed.options);
    await maybeOpen(parsed.options.open, result.markdownPath);
    console.log(`Generated share report:\n- Markdown: ${result.markdownPath}`);
    return;
  }

  if (command === "suggest") {
    const result = await suggestCommand(targetDir, parsed.options);
    await maybeOpen(parsed.options.open, result.markdownPath);
    console.log(`Generated suggestions:\n- Markdown: ${result.markdownPath}`);
    return;
  }

  if (command === "morning") {
    await morningCommand(targetDir, parsed.options);
    console.log(`Completed morning run: ${targetDir}

Next:
1. Open the dashboard: pm-agent dashboard ${targetDir}
2. Review Today's Focus.
3. Discover Issue candidates: pm-agent task ${targetDir} discover --source github
4. Activate one candidate: pm-agent task ${targetDir} import --number 1 --list active
5. Confirm active tasks: pm-agent task ${targetDir} list --list active`);
    return;
  }

  if (command === "task") {
    const message = await taskCommand(targetDir, parsed.taskAction, parsed.options);
    console.log(message);
    return;
  }

  if (command === "repo") {
    const message = await repositoryCommand(targetDir, parsed.taskAction, parsed.options);
    console.log(message);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`pm-agent

Usage:
  pm-agent init [ledger-dir]
  pm-agent setup [ledger-dir] [--ledger-name progress-ledger] [--private|--public] [--owner github-user] [--select-repos] [--repo-scope all|owned|collaborating] [--no-github]
  pm-agent collect [ledger-dir]
  pm-agent dashboard [ledger-dir] [--port 4783] [--no-open]
  pm-agent understand [repo-dir] [--refresh] [--budget cheap|standard|deep]
  pm-agent understand-active [ledger-dir] [--refresh] [--no-github]
  pm-agent report [ledger-dir] [--adapter mock|background-agent] [--open]
  pm-agent share [ledger-dir] [--open]
  pm-agent suggest [ledger-dir] [--open]
  pm-agent morning [ledger-dir] [--adapter mock|background-agent]
  pm-agent task [ledger-dir] add --list active --title "Task title"
  pm-agent task [ledger-dir] move --from active --to done --title "Task title"
  pm-agent task [ledger-dir] list [--list active]
  pm-agent task [ledger-dir] discover [--source local|github] [--repo repo-id] [--scope mine|all]
  pm-agent task [ledger-dir] import --number 1 --list active
  pm-agent task [ledger-dir] split-issue --repo repo-id --number 123 [--apply]
  pm-agent repo [ledger-dir] activate --repo repo-id
  pm-agent repo [ledger-dir] deactivate --repo repo-id
  pm-agent repo [ledger-dir] active
  pm-agent shell [ledger-dir]
`);
}

function parseArgs(args: string[]): {
  target?: string;
  taskAction?: string;
  options: {
    adapter?: string;
    date?: string;
    list?: string;
    title?: string;
    from?: string;
    to?: string;
    repo?: string;
    source?: string;
    scope?: string;
    ledgerName?: string;
    owner?: string;
    visibility?: "private" | "public";
    github?: boolean;
    selectRepos?: boolean;
    repoScope?: string;
    open?: boolean;
    apply?: boolean;
    port?: string;
    id?: string;
    number?: string;
    refresh?: boolean;
    budget?: string;
  };
} {
  const options: {
    adapter?: string;
    date?: string;
    list?: string;
    title?: string;
    from?: string;
    to?: string;
    repo?: string;
    source?: string;
    scope?: string;
    ledgerName?: string;
    owner?: string;
    visibility?: "private" | "public";
    github?: boolean;
    selectRepos?: boolean;
    repoScope?: string;
    open?: boolean;
    apply?: boolean;
    port?: string;
    id?: string;
    number?: string;
    refresh?: boolean;
    budget?: string;
  } = {};
  let target: string | undefined;
  let taskAction: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--adapter") {
      options.adapter = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--date") {
      options.date = assertDateString(args[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--list") {
      options.list = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--from") {
      options.from = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--to") {
      options.to = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--repo") {
      options.repo = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--source") {
      options.source = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--scope") {
      options.scope = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--ledger-name") {
      options.ledgerName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--owner") {
      options.owner = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--private") {
      options.visibility = "private";
      continue;
    }
    if (arg === "--public") {
      options.visibility = "public";
      continue;
    }
    if (arg === "--no-github") {
      options.github = false;
      continue;
    }
    if (arg === "--select-repos") {
      options.selectRepos = true;
      continue;
    }
    if (arg === "--repo-scope") {
      options.repoScope = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--open") {
      options.open = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-open") {
      options.open = false;
      continue;
    }
    if (arg === "--port") {
      options.port = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--id") {
      options.id = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--number") {
      options.number = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (arg === "--budget") {
      options.budget = args[index + 1];
      index += 1;
      continue;
    }
    if (!target) target = arg;
    else if (!taskAction) taskAction = arg;
  }

  return { target, taskAction, options };
}

async function maybeOpen(shouldOpen: boolean | undefined, filePath: string): Promise<void> {
  if (!shouldOpen) return;
  await openFile(filePath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
