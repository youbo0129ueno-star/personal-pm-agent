import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { collectCommand } from "./commands/collect.js";
import { openDashboard, type DashboardTab } from "./commands/dashboard.js";
import { morningCommand } from "./commands/morning.js";
import { reportCommand } from "./commands/report.js";
import { repositoryCommand } from "./commands/repository.js";
import { shareCommand } from "./commands/share.js";
import { statusCommand } from "./commands/status.js";
import { suggestCommand } from "./commands/suggest.js";
import { taskCommand } from "./commands/task.js";
import { understandActiveCommand } from "./commands/understand-active.js";
import { understandCommand } from "./commands/understand.js";

export async function startShell(targetDir: string): Promise<void> {
  const rl = readline.createInterface({ input, output, prompt: "pm-agent> " });
  console.log("Personal PM Agent shell. Type /help for commands, /exit to quit.");
  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      continue;
    }

    if (line === "/exit" || line === "/quit") {
      break;
    }

    try {
      const message = await runShellCommand(targetDir, line);
      if (message) console.log(message);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }

    rl.prompt();
  }

  rl.close();
}

async function runShellCommand(targetDir: string, line: string): Promise<string> {
  const [command, ...args] = tokenize(line);

  if (command === "/help") return helpText();
  if (command === "/status") return statusCommand(targetDir);
  if (command === "/dashboard") {
    const tab = parseDashboardTab(args[0] ?? "status");
    const dashboardUrl = await openDashboard(targetDir, tab);
    return `Opened dashboard:\n- Dashboard: ${dashboardUrl}`;
  }
  if (command === "/understand") {
    const repoDir = args.find((arg) => !arg.startsWith("--")) ?? process.cwd();
    const result = await understandCommand(repoDir, { refresh: args.includes("--refresh"), budget: parseOption(args, "--budget") });
    return `${result}\n\nNext:\n- Review .pm-agent/project/project-brief.md in that repository.\n- Review .pm-agent/project/area-map.md for planning by area.\n- Review .pm-agent/safety/safety-report.md before using summaries for LLM planning.`;
  }
  if (command === "/understand-active") {
    const result = await understandActiveCommand(targetDir, { refresh: args.includes("--refresh"), github: !args.includes("--no-github") });
    return `${result}\n\nNext:\n- Run /dashboard repositories to inspect active repo understanding.`;
  }
  if (command === "/activate-repo") {
    return repositoryCommand(targetDir, "activate", { repo: args[0] });
  }
  if (command === "/register-repo") {
    return repositoryCommand(targetDir, "register", { repo: args[0] });
  }
  if (command === "/deactivate-repo") {
    return repositoryCommand(targetDir, "deactivate", { repo: args[0] });
  }
  if (command === "/active-repos") {
    return repositoryCommand(targetDir, "active", {});
  }
  if (command === "/repos") {
    return repositoryCommand(targetDir, "list", {});
  }
  if (command === "/collect") {
    await collectCommand(targetDir);
    return `Collected context.\n\nNext:\n- Run /report to generate today's PM report.\n- Run /morning to run collect, report, share, and suggest together.`;
  }
  if (command === "/report") {
    const result = await reportCommand(targetDir, { adapter: parseOption(args, "--adapter") ?? "background-agent" });
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "daily");
    return `Generated PM report${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n- Markdown: ${result.markdownPath}\n- JSON: ${result.jsonPath}\n\nNext:\n- Review Today's Focus in the dashboard.\n- Run /discover github to find GitHub Issues you can activate.\n- Run /import <number> --list active to add an Issue candidate to active tasks.`;
  }
  if (command === "/share") {
    const result = await shareCommand(targetDir);
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "share");
    return `Generated share report${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n- Markdown: ${result.markdownPath}\n\nNext:\n- Use Copy View in the dashboard to paste the share message elsewhere.`;
  }
  if (command === "/suggest") {
    const result = await suggestCommand(targetDir);
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "suggestions");
    return `Generated suggestions${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n- Markdown: ${result.markdownPath}\n\nNext:\n- Review suggested ledger updates before editing task files.\n- Run /dashboard tasks to check the current active/waiting/backlog state.`;
  }
  if (command === "/morning") {
    await morningCommand(targetDir, { adapter: parseOption(args, "--adapter") ?? "background-agent" });
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "daily");
    return `Completed morning run${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n\nNext:\n1. Read Today's Focus in the dashboard.\n2. Run /discover github to list open Issues assigned to you across registered repos.\n3. Run /discover github <repo-id> if you want to narrow it down.\n4. Run /import <number> --list active to activate an Issue candidate.\n5. Run /tasks active or /dashboard tasks to confirm active tasks.\n6. If an Issue is too large, run /split-issue <repo-id> <issue-number> first.`;
  }
  if (command === "/tasks") {
    return taskCommand(targetDir, "list", { list: args[0] });
  }
  if (command === "/add") {
    return taskCommand(targetDir, "add", {
      list: parseOption(args, "--list") ?? "active",
      repo: parseOption(args, "--repo"),
      title: args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--list" && args[index - 1] !== "--repo").join(" ")
    });
  }
  if (command === "/move") {
    return taskCommand(targetDir, "move", {
      from: parseOption(args, "--from"),
      to: parseOption(args, "--to"),
      title: args.filter((arg) => !arg.startsWith("--")).slice(4).join(" ")
    });
  }
  if (command === "/discover") {
    const positional = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--source" && args[index - 1] !== "--scope");
    const source = positional[0] === "github" || positional[0] === "local" ? positional[0] : parseOption(args, "--source") ?? "local";
    const repo = positional[0] === "github" || positional[0] === "local" ? positional[1] : parseOption(args, "--repo") ?? positional[0];
    const result = await taskCommand(targetDir, "discover", { repo, source, scope: parseOption(args, "--scope") ?? "mine" });
    return `${result}\n\nNext:\n- Run /import <number> --list active to activate one candidate.\n- Run /import <id> --list active if you prefer the candidate id.\n- Run /dashboard tasks after importing.`;
  }
  if (command === "/split-issue") {
    const positional = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--number");
    return taskCommand(targetDir, "split-issue", {
      repo: parseOption(args, "--repo") ?? positional[0],
      number: parseOption(args, "--number") ?? positional[1],
      apply: args.includes("--apply")
    });
  }
  if (command === "/import") {
    const result = await taskCommand(targetDir, "import", {
      number: args[0] && /^\d+$/.test(args[0]) ? args[0] : undefined,
      id: args[0] && !/^\d+$/.test(args[0]) ? args[0] : undefined,
      list: parseOption(args, "--list") ?? "active"
    });
    return `${result}\n\nNext:\n- Run /tasks active to confirm it is active.\n- Run /dashboard tasks to view it in the browser.\n- Run /morning again if you want today's report to include the activated task.`;
  }

  return `Unknown command: ${command}. Type /help.`;
}

function parseOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function tokenize(line: string): string[] {
  const matches = line.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((match) => match.replace(/^["']|["']$/g, ""));
}

function parseDashboardTab(value: string): DashboardTab {
  const tabs: DashboardTab[] = ["status", "daily", "share", "suggestions", "tasks", "repositories", "files"];
  if (tabs.includes(value as DashboardTab)) return value as DashboardTab;
  throw new Error(`Unknown dashboard tab: ${value}. Expected ${tabs.join(", ")}.`);
}

async function openDashboardUnlessDisabled(args: string[], targetDir: string, tab: DashboardTab): Promise<string | null> {
  if (args.includes("--no-open")) return null;
  try {
    return await openDashboard(targetDir, tab);
  } catch {
    return null;
  }
}

function helpText(): string {
  return `Commands:
/status                 Show today's report summary
/morning [--adapter background-agent|mock]
/collect
/dashboard [status|daily|share|suggestions|tasks|repositories|files]
/understand [repo-dir] [--refresh]
/understand-active [--refresh] [--no-github]
/activate-repo <repo-id>
/register-repo <repo-id>
/deactivate-repo <repo-id>
/active-repos
/repos
/report [--adapter background-agent|mock] [--no-open]
/share [--no-open]
/suggest [--no-open]
/tasks [active|waiting|delegated|backlog|done]
/discover [repo-id]     Discover local task candidates from linked repos
/discover github [repo-id] [--scope mine|all]
/split-issue <repo-id> <issue-number> [--apply]
/import <number|id> [--list active]
/add <title> [--list active] [--repo repo-id]
/exit`;
}
