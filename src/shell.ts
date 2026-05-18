import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { collectCommand } from "./commands/collect.js";
import { openDashboard } from "./commands/dashboard.js";
import { morningCommand } from "./commands/morning.js";
import { reportCommand } from "./commands/report.js";
import { shareCommand } from "./commands/share.js";
import { statusCommand } from "./commands/status.js";
import { suggestCommand } from "./commands/suggest.js";
import { taskCommand } from "./commands/task.js";

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
  if (command === "/collect") {
    await collectCommand(targetDir);
    return "Collected context.";
  }
  if (command === "/report") {
    const result = await reportCommand(targetDir, { adapter: parseOption(args, "--adapter") ?? "background-agent" });
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "daily");
    return `Generated PM report${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n- Markdown: ${result.markdownPath}\n- JSON: ${result.jsonPath}`;
  }
  if (command === "/share") {
    const result = await shareCommand(targetDir);
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "share");
    return `Generated share report${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n- Markdown: ${result.markdownPath}`;
  }
  if (command === "/suggest") {
    const result = await suggestCommand(targetDir);
    const dashboardUrl = await openDashboardUnlessDisabled(args, targetDir, "suggestions");
    return `Generated suggestions${dashboardUrl ? " and opened dashboard" : ""}:\n- Dashboard: ${dashboardUrl ?? "(not opened)"}\n- Markdown: ${result.markdownPath}`;
  }
  if (command === "/morning") {
    await morningCommand(targetDir, { adapter: parseOption(args, "--adapter") ?? "background-agent" });
    return "Completed morning run.";
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
    const positional = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--repo" && args[index - 1] !== "--source");
    const source = positional[0] === "github" || positional[0] === "local" ? positional[0] : parseOption(args, "--source") ?? "local";
    const repo = positional[0] === "github" || positional[0] === "local" ? positional[1] : parseOption(args, "--repo") ?? positional[0];
    return taskCommand(targetDir, "discover", { repo, source });
  }
  if (command === "/import") {
    return taskCommand(targetDir, "import", {
      number: args[0] && /^\d+$/.test(args[0]) ? args[0] : undefined,
      id: args[0] && !/^\d+$/.test(args[0]) ? args[0] : undefined,
      list: parseOption(args, "--list") ?? "active"
    });
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

async function openDashboardUnlessDisabled(args: string[], targetDir: string, tab: "daily" | "share" | "suggestions"): Promise<string | null> {
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
/report [--adapter background-agent|mock] [--no-open]
/share [--no-open]
/suggest [--no-open]
/tasks [active|waiting|delegated|backlog|done]
/discover [repo-id]     Discover local task candidates from linked repos
/discover github [repo-id]
/import <number|id> [--list active]
/add <title> [--list active] [--repo repo-id]
/exit`;
}
