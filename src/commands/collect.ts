import path from "node:path";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, type PmAgentConfig } from "../core/config.js";
import { today } from "../core/date.js";
import { collectGitSummary } from "../core/git.js";
import { listMarkdownFiles, listRecentMarkdownFiles, readTextIfExists, writeJson } from "../core/fs.js";
import { extractBullets, extractChecklist, extractSection, parseFrontmatter, parseRepositoryLinks } from "../core/markdown.js";
import type { CollectedItem, ContextPack } from "../core/types.js";

const execFileAsync = promisify(execFile);

type GitHubIssueItem = {
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  repo: string;
  repository: string;
  labels?: unknown[];
  assignees?: unknown[];
};

export async function collectCommand(targetDir: string, date = today()): Promise<void> {
  const config = await loadConfig(targetDir);
  const collectConfig = config.collect ?? {};
  const rawItems: CollectedItem[] = [];

  const projectFiles = isEnabled(collectConfig.projects) ? await listMarkdownFiles(path.join(targetDir, "projects")) : [];
  const projects = await Promise.all(projectFiles.map(async (file) => collectProject(file, rawItems)));

  const tasks = isEnabled(collectConfig.tasks) ? await collectTasks(targetDir, rawItems) : [];
  const recentLogs = isEnabled(collectConfig.dailyLogs)
    ? await collectRecentLogs(targetDir, rawItems, collectConfig.dailyLogs?.days ?? 7)
    : [];
  const people = isEnabled(collectConfig.people) ? await collectPeople(targetDir, rawItems) : [];
  const repositories = isEnabled(collectConfig.repositories)
    ? await collectRepositories(targetDir, rawItems, config)
    : [];
  const githubIssues = isEnabled(collectConfig.githubIssues)
    ? await collectGitHubIssues(targetDir, rawItems, config)
    : [];
  const previousReport = isEnabled(collectConfig.previousReport) ? await collectPreviousReport(targetDir, date, rawItems) : null;

  const pack: ContextPack = {
    date,
    workspace: {
      name: basename(targetDir),
      path: targetDir
    },
    projects,
    tasks,
    people,
    recent_logs: recentLogs,
    repositories,
    github_issues: githubIssues,
    previous_report: previousReport,
    collected_items: rawItems.length
  };

  const outputDir = path.join(targetDir, "ai/outputs", date);
  await writeJson(path.join(outputDir, "context-raw.json"), {
    date,
    items: rawItems
  });
  await writeJson(path.join(outputDir, "context-pack.json"), pack);
}

async function collectGitHubIssues(
  targetDir: string,
  rawItems: CollectedItem[],
  config: PmAgentConfig
): Promise<GitHubIssueItem[]> {
  const file = path.join(targetDir, "links/repositories.md");
  const markdown = (await readTextIfExists(file)) ?? "";
  if (!markdown.trim()) return [];

  const limit = String(config.collect?.githubIssues?.limit ?? 50);
  const links = parseRepositoryLinks(markdown).filter((repo) => repo.github || repo.full_name || repo.id?.includes("/"));
  const issues: GitHubIssueItem[] = (
    await Promise.all(
      links.map(async (repo) => {
        const fullName = repo.github ?? repo.full_name ?? repo.id;
        try {
          const { stdout } = await execFileAsync(
            "gh",
            [
              "issue",
              "list",
              "--repo",
              fullName,
              "--state",
              "open",
              "--assignee",
              "@me",
              "--limit",
              limit,
              "--json",
              "number,title,body,url,labels,assignees"
            ],
            { maxBuffer: 1024 * 1024 }
          );
          const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
          return parsed.map((issue) => ({ ...issue, repo: repo.id, repository: fullName }));
        } catch {
          return [];
        }
      })
    )
  ).flat();

  for (const issue of issues) {
    rawItems.push({
      source: String(issue.repository),
      type: "github_issue",
      title: `Issue #${issue.number}: ${issue.title}`,
      body: String(issue.body ?? ""),
      url: typeof issue.url === "string" ? issue.url : undefined,
      metadata: issue
    });
  }

  return issues;
}

async function collectProject(file: string, rawItems: CollectedItem[]): Promise<Record<string, unknown>> {
  const markdown = (await readTextIfExists(file)) ?? "";
  const parsed = parseFrontmatter(markdown);
  const body = parsed.body;
  const project: Record<string, unknown> = {
    ...parsed.frontmatter,
    source: path.relative(process.cwd(), file),
    goal: extractSection(body, "Goal"),
    current_status: extractSection(body, "Current Status"),
    collaborators: extractSection(body, "Collaborators"),
    active_tasks: extractChecklist(extractSection(body, "Active Tasks")),
    blockers: extractBullets(extractSection(body, "Blockers")),
    next_actions: extractBullets(extractSection(body, "Next Actions")),
    related_repositories: extractBullets(extractSection(body, "Related Repositories")),
    last_updated: extractSection(body, "Last Updated")
  };

  rawItems.push({
    source: file,
    type: "project",
    title: String(project.name ?? path.basename(file, ".md")),
    body,
    metadata: parsed.frontmatter
  });

  return project;
}

async function collectTasks(targetDir: string, rawItems: CollectedItem[]): Promise<Array<Record<string, unknown>>> {
  const taskFiles = ["active", "waiting", "delegated", "backlog", "done"];
  const tasks: Array<Record<string, unknown>> = [];

  for (const name of taskFiles) {
    const file = path.join(targetDir, "tasks", `${name}.md`);
    const markdown = await readTextIfExists(file);
    if (!markdown) continue;

    const items = extractChecklist(markdown);
    tasks.push({ list: name, items, body: markdown.trim() });
    rawItems.push({
      source: file,
      type: "task",
      title: name,
      body: markdown.trim(),
      metadata: { count: items.length }
    });
  }

  return tasks;
}

async function collectRecentLogs(targetDir: string, rawItems: CollectedItem[], days: number): Promise<Array<Record<string, unknown>>> {
  const files = await listRecentMarkdownFiles(path.join(targetDir, "logs/daily"), days);
  const logs: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const body = (await readTextIfExists(file))?.trim() ?? "";
    const date = path.basename(file, ".md");
    logs.push({ date, body });
    rawItems.push({ source: file, type: "note", title: `daily log ${date}`, body, timestamp: date });
  }

  return logs;
}

async function collectPeople(targetDir: string, rawItems: CollectedItem[]): Promise<Array<Record<string, unknown>>> {
  const file = path.join(targetDir, "context/people.md");
  const body = (await readTextIfExists(file))?.trim() ?? "";
  if (!body) return [];

  rawItems.push({ source: file, type: "person", title: "people", body });
  return body
    .split(/\n## /)
    .filter((section) => section.trim() && !section.startsWith("# People"))
    .map((section) => {
      const [nameLine, ...rest] = section.split(/\r?\n/);
      return {
        name: nameLine.replace(/^## /, "").trim(),
        body: rest.join("\n").trim()
      };
    });
}

async function collectRepositories(
  targetDir: string,
  rawItems: CollectedItem[],
  config: PmAgentConfig
): Promise<Array<Record<string, unknown>>> {
  const file = path.join(targetDir, "links/repositories.md");
  const markdown = (await readTextIfExists(file)) ?? "";
  if (!markdown.trim()) return [];

  const links = parseRepositoryLinks(markdown);
  const repositories: Array<Record<string, unknown> & { id?: string; path?: string; git: Record<string, unknown> | null }> = await Promise.all(
    links.map(async (repo) => ({
      ...repo,
      git: config.collect?.repositories?.includeGitStatus === false || !repo.path ? null : await collectGitSummary(repo.path)
    }))
  );

  rawItems.push({
    source: file,
    type: "repository",
    title: "repositories",
    body: markdown.trim(),
    metadata: { count: repositories.length }
  });

  for (const repo of repositories) {
    rawItems.push({
      source: String(repo.path),
      type: "git",
      title: String(repo.id),
      body: JSON.stringify(repo.git, null, 2),
      metadata: repo
    });
  }

  return repositories;
}

function isEnabled(config: { enabled?: boolean } | undefined): boolean {
  return config?.enabled !== false;
}

async function collectPreviousReport(
  targetDir: string,
  date: string,
  rawItems: CollectedItem[]
): Promise<Record<string, unknown> | null> {
  const previous = await readPreviousJson(targetDir, date);
  if (!previous) return null;

  rawItems.push({
    source: previous.source,
    type: "previous_report",
    title: "previous pm report",
    body: JSON.stringify(previous.report, null, 2)
  });
  return previous.report;
}

async function readPreviousJson(
  targetDir: string,
  date: string
): Promise<{ source: string; report: Record<string, unknown> } | null> {
  const outputsPath = path.join(targetDir, "ai/outputs");
  const { readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  if (!existsSync(outputsPath)) return null;

  const dirs = (await readdir(outputsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < date)
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs.reverse()) {
    const file = path.join(outputsPath, dir, "pm-report.json");
    const text = await readTextIfExists(file);
    if (!text) continue;
    try {
      return { source: file, report: JSON.parse(text) as Record<string, unknown> };
    } catch {
      continue;
    }
  }

  return null;
}
