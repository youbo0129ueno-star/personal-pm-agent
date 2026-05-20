import path from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { expandHome } from "../core/git.js";
import { ensureDir, writeJson } from "../core/fs.js";
import { parseRepositoryLinks } from "../core/markdown.js";
import { readExplicitActiveRepositoryIds } from "./repository.js";
import { understandCommand } from "./understand.js";

const execFileAsync = promisify(execFile);

export type UnderstandActiveOptions = {
  refresh?: boolean;
  github?: boolean;
};

type RegisteredRepository = Record<string, string>;

type ActiveRepository = {
  repo: RegisteredRepository;
  reason: string;
};

export async function understandActiveCommand(ledgerDir: string, options: UnderstandActiveOptions = {}): Promise<string> {
  const repositories = await readRegisteredRepositories(ledgerDir);
  const activeRepos = await findActiveRepositories(ledgerDir, repositories, options);

  if (activeRepos.length === 0) {
    return [
      "No active repositories found.",
      "",
      "Active means:",
      "- explicitly activated in context/active-repositories.md",
      "- referenced by tasks/active.md with <!-- repo:<repo-id> -->",
      "- or has an open GitHub Issue assigned to you",
      "",
      "Next:",
      "- Run /activate-repo <repo-id>",
      "- Run /discover github <repo-id>",
      "- Run /import <number> --list active",
      "- Or add a task with /add \"task\" --list active --repo <repo-id>"
    ].join("\n");
  }

  const results: string[] = [];
  let completed = 0;
  let remoteCompleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const active of activeRepos) {
    const repo = active.repo;
    const repoId = repo.id;
    const repoPath = await resolveRepositoryPath(ledgerDir, repo);
    if (!repoPath && repo.github) {
      try {
        const outputDir = await writeRemoteRepositoryUnderstanding(ledgerDir, repo, active.reason);
        remoteCompleted += 1;
        results.push(`◇ ${repoId}\n  mode: GitHub remote context\n  output: ${outputDir}\n  active reason: ${active.reason}`);
      } catch (error) {
        failed += 1;
        results.push(`✗ ${repoId} remote context failed\n  reason: ${error instanceof Error ? error.message : String(error)}\n  active reason: ${active.reason}`);
      }
      continue;
    }

    if (!repoPath) {
      skipped += 1;
      results.push(`- ${repoId} skipped\n  reason: no local clone found and no github: owner/name is registered\n  active reason: ${active.reason}`);
      continue;
    }

    try {
      await understandCommand(repoPath, { refresh: options.refresh });
      completed += 1;
      results.push(`✓ ${repoId}\n  path: ${repoPath}\n  active reason: ${active.reason}`);
    } catch (error) {
      failed += 1;
      results.push(`✗ ${repoId} failed\n  reason: ${error instanceof Error ? error.message : String(error)}\n  active reason: ${active.reason}`);
    }
  }

  return [
    "Understanding active repositories...",
    "",
    ...results,
    "",
    "Summary:",
    `- completed: ${completed}`,
    `- remote context: ${remoteCompleted}`,
    `- skipped: ${skipped}`,
    `- failed: ${failed}`,
    "",
    "Open dashboard:",
    "pm-agent dashboard <ledger-dir>"
  ].join("\n");
}

async function readRegisteredRepositories(ledgerDir: string): Promise<RegisteredRepository[]> {
  const file = path.join(ledgerDir, "links/repositories.md");
  const markdown = existsSync(file) ? await readFile(file, "utf8") : "";
  return parseRepositoryLinks(markdown).filter((repo) => repo.id);
}

async function findActiveRepositories(
  ledgerDir: string,
  repositories: RegisteredRepository[],
  options: UnderstandActiveOptions
): Promise<ActiveRepository[]> {
  const byId = new Map(repositories.map((repo) => [repo.id, repo]));
  const active = new Map<string, ActiveRepository>();

  for (const repoId of await readExplicitActiveRepositoryIds(ledgerDir)) {
    const repo = byId.get(repoId);
    if (repo) active.set(repoId, { repo, reason: "context/active-repositories.md" });
  }

  for (const repoId of await repoIdsFromActiveTasks(ledgerDir)) {
    const repo = byId.get(repoId);
    if (repo) active.set(repoId, { repo, reason: "tasks/active.md" });
  }

  if (options.github !== false) {
    for (const repo of repositories) {
      if (!repo.github) continue;
      if (active.has(repo.id)) continue;
      if (await hasAssignedOpenIssue(repo.github)) {
        active.set(repo.id, { repo, reason: "assigned open GitHub Issue" });
      }
    }
  }

  return [...active.values()].sort((a, b) => a.repo.id.localeCompare(b.repo.id));
}

async function repoIdsFromActiveTasks(ledgerDir: string): Promise<string[]> {
  const file = path.join(ledgerDir, "tasks/active.md");
  const markdown = existsSync(file) ? await readFile(file, "utf8") : "";
  return [...markdown.matchAll(/<!--\s*repo:([A-Za-z0-9_.-]+)\s*-->/g)].map((match) => match[1]);
}

async function hasAssignedOpenIssue(repoFullName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "issue",
      "list",
      "--repo",
      repoFullName,
      "--state",
      "open",
      "--assignee",
      "@me",
      "--limit",
      "1",
      "--json",
      "number"
    ]);
    const issues = JSON.parse(stdout) as unknown[];
    return issues.length > 0;
  } catch {
    return false;
  }
}

async function resolveRepositoryPath(ledgerDir: string, repo: RegisteredRepository): Promise<string | undefined> {
  const candidates = [
    repo.path ? expandHome(repo.path) : "",
    path.join(path.dirname(ledgerDir), repo.id)
  ].filter(Boolean);
  const direct = candidates.find((candidate) => isGitRepository(candidate));
  if (direct) return direct;

  return findExistingClone(ledgerDir, repo);
}

function isGitRepository(dir: string): boolean {
  return existsSync(path.join(dir, ".git"));
}

async function findExistingClone(ledgerDir: string, repo: RegisteredRepository): Promise<string | undefined> {
  const roots = unique([
    ...splitSearchRoots(process.env.PM_AGENT_REPO_ROOTS),
    path.dirname(ledgerDir),
    path.join(homedir(), "work"),
    process.cwd()
  ]).filter((root) => existsSync(root));
  const names = unique([repo.id, repo.name].filter(Boolean));

  for (const root of roots) {
    const found = await searchCloneByName(root, names, 3);
    if (found && (!repo.github || await repositoryRemoteMatches(found, repo.github))) return found;
    if (found) return found;
  }

  return undefined;
}

function splitSearchRoots(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(path.delimiter).map((root) => expandHome(root.trim())).filter(Boolean);
}

async function searchCloneByName(root: string, names: string[], maxDepth: number): Promise<string | undefined> {
  if (maxDepth < 0) return undefined;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (shouldSkipDirectory(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (names.includes(entry.name) && isGitRepository(fullPath)) return fullPath;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (shouldSkipDirectory(entry.name)) continue;
    const found = await searchCloneByName(path.join(root, entry.name), names, maxDepth - 1);
    if (found) return found;
  }

  return undefined;
}

function shouldSkipDirectory(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "Library" || name.startsWith(".");
}

async function repositoryRemoteMatches(repoPath: string, fullName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "remote", "get-url", "origin"]);
    return normalizeGitHubRemote(stdout.trim()).endsWith(`/${fullName.toLowerCase()}`);
  } catch {
    return false;
  }
}

function normalizeGitHubRemote(remote: string): string {
  return remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^https:\/\/github\.com\//, "https://github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

async function writeRemoteRepositoryUnderstanding(
  ledgerDir: string,
  repo: RegisteredRepository,
  activeReason: string
): Promise<string> {
  const fullName = repo.github;
  if (!fullName) throw new Error("Missing github: owner/name");

  const [view, issues, readme] = await Promise.all([
    ghJson<GitHubRepoView>(["repo", "view", fullName, "--json", "nameWithOwner,description,homepageUrl,repositoryTopics,primaryLanguage,url,defaultBranchRef,isPrivate"]),
    ghJson<GitHubIssue[]>(["issue", "list", "--repo", fullName, "--state", "open", "--assignee", "@me", "--limit", "30", "--json", "number,title,body,url,labels,assignees,updatedAt"]),
    readGitHubReadme(fullName)
  ]);

  const baseDir = path.join(ledgerDir, ".pm-agent", "remote-repositories", repo.id);
  const projectDir = path.join(baseDir, "project");
  const safetyDir = path.join(baseDir, "safety");
  await ensureDir(projectDir);
  await ensureDir(safetyDir);

  const brief = renderRemoteProjectBrief(repo, view, readme, issues, activeReason);
  const issueMap = renderRemoteIssueMap(repo, issues);
  const areaMap = renderRemoteAreaMap(repo, view, issues);
  const capabilityMap = renderRemoteCapabilityMap(repo, view, issues);
  const safetyReport = renderRemoteSafetyReport(repo);

  await writeFile(path.join(projectDir, "project-brief.md"), brief, "utf8");
  await writeFile(path.join(projectDir, "area-map.md"), areaMap, "utf8");
  await writeFile(path.join(projectDir, "capability-map.md"), capabilityMap, "utf8");
  await writeFile(path.join(projectDir, "issue-map.md"), issueMap, "utf8");
  await writeJson(path.join(projectDir, "repository-context.json"), {
    repository: repo,
    github: view,
    activeReason,
    issues,
    readmeExcerpt: truncate(readme, 4000),
    generatedAt: new Date().toISOString(),
    mode: "github-remote"
  });
  await writeFile(path.join(safetyDir, "safety-report.md"), safetyReport, "utf8");

  return baseDir;
}

type GitHubRepoView = {
  nameWithOwner?: string;
  description?: string;
  homepageUrl?: string;
  repositoryTopics?: Array<{ name?: string }>;
  primaryLanguage?: { name?: string };
  url?: string;
  defaultBranchRef?: { name?: string };
  isPrivate?: boolean;
};

type GitHubIssue = {
  number: number;
  title: string;
  body?: string;
  url?: string;
  updatedAt?: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
};

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args);
  return JSON.parse(stdout) as T;
}

async function readGitHubReadme(fullName: string): Promise<string> {
  try {
    const readme = await ghJson<{ content?: string; encoding?: string }>(["api", `repos/${fullName}/readme`]);
    if (!readme.content) return "";
    return Buffer.from(readme.content.replace(/\n/g, ""), readme.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  } catch {
    return "";
  }
}

function renderRemoteProjectBrief(
  repo: RegisteredRepository,
  view: GitHubRepoView,
  readme: string,
  issues: GitHubIssue[],
  activeReason: string
): string {
  const topics = (view.repositoryTopics ?? []).map((topic) => topic.name).filter(Boolean).join(", ") || "なし";
  const issueLines = issues.length > 0
    ? issues.map((issue) => `- #${issue.number} ${issue.title}${issue.url ? ` (${issue.url})` : ""}`).join("\n")
    : "- 自分にassignされたopen Issueはありません。";

  return `# Remote Project Brief: ${repo.id}

## Purpose

${view.description || "GitHub metadataからは説明を取得できませんでした。READMEやIssueを追加すると理解精度が上がります。"}

## Repository

- id: ${repo.id}
- github: ${repo.github ?? "未登録"}
- url: ${view.url ?? ""}
- private: ${view.isPrivate ? "yes" : "no"}
- default_branch: ${view.defaultBranchRef?.name ?? "unknown"}
- primary_language: ${view.primaryLanguage?.name ?? "unknown"}
- topics: ${topics}
- active_reason: ${activeReason}

## Current Work

${issueLines}

## README Excerpt

${truncate(readme || "READMEは取得できませんでした。", 4000)}

## Planning Notes

- このbriefはローカルcloneなしで生成したremote contextです。
- ファイル構造、依存関係、重要ファイル選定は未実行です。
- 深い実装理解が必要な場合は、このrepoのローカルpathを links/repositories.md に登録してください。
`;
}

function renderRemoteIssueMap(repo: RegisteredRepository, issues: GitHubIssue[]): string {
  const body = issues.length > 0
    ? issues.map((issue) => {
        const labels = (issue.labels ?? []).map((label) => label.name).filter(Boolean).join(", ") || "none";
        const assignees = (issue.assignees ?? []).map((assignee) => assignee.login).filter(Boolean).join(", ") || "none";
        return `## Issue #${issue.number}: ${issue.title}

- url: ${issue.url ?? ""}
- labels: ${labels}
- assignees: ${assignees}
- updated_at: ${issue.updatedAt ?? ""}

### Body Excerpt

${truncate(issue.body?.trim() || "Issue body is empty.", 1500)}
`;
      }).join("\n")
    : "自分にassignされたopen Issueはありません。\n";

  return `# Remote Issue Map: ${repo.id}

${body}`;
}

function renderRemoteAreaMap(repo: RegisteredRepository, view: GitHubRepoView, issues: GitHubIssue[]): string {
  const issueCount = issues.length;
  const language = view.primaryLanguage?.name ?? "unknown";
  const topicLines = (view.repositoryTopics ?? [])
    .map((topic) => topic.name)
    .filter(Boolean)
    .map((topic) => `- ${topic}`)
    .join("\n") || "- none";

  return `# Remote Area Map: ${repo.id}

## Repository Overview

- primary_language: ${language}
- active_assigned_issues: ${issueCount}
- source: GitHub metadata / README / Issues

## Topic Signals

${topicLines}

## Limitations

- ローカルファイルを読んでいないため、実装area、依存関係、重要ファイルは未確定です。
- Issue本文とREADMEから計画は作れますが、コード変更範囲の推定にはローカルpath登録かclone探索が必要です。
`;
}

function renderRemoteCapabilityMap(repo: RegisteredRepository, view: GitHubRepoView, issues: GitHubIssue[]): string {
  const issueSignals = new Map<string, GitHubIssue[]>();
  for (const issue of issues) {
    for (const signal of collectRemoteIssueSignals(issue)) {
      issueSignals.set(signal, [...(issueSignals.get(signal) ?? []), issue]);
    }
  }
  const topicSignals = (view.repositoryTopics ?? []).map((topic) => topic.name).filter(Boolean) as string[];
  const body = [...issueSignals.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([signal, relatedIssues]) => `## ${signal}

Inferred from assigned open Issues.

### Related Issues
${relatedIssues.map((issue) => `- #${issue.number} ${issue.title}`).join("\n")}
`)
    .join("\n") || "No capability signals were inferred from assigned Issues.\n";

  return `# Remote Capability Map: ${repo.id}

## Repository Topic Signals
${topicSignals.map((topic) => `- ${topic}`).join("\n") || "- none"}

${body}`;
}

function collectRemoteIssueSignals(issue: GitHubIssue): string[] {
  const raw = `${issue.title} ${issue.body ?? ""} ${(issue.labels ?? []).map((label) => label.name).join(" ")}`;
  return [...new Set(raw
    .split(/[^A-Za-z0-9_\-\u3040-\u30ff\u3400-\u9fff]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3)
    .slice(0, 40))];
}

function renderRemoteSafetyReport(repo: RegisteredRepository): string {
  return `# Remote Safety Report: ${repo.id}

## Scope

- mode: GitHub remote context
- raw local files read: no
- generated from: GitHub repository metadata, README, assigned open Issues

## Notes

ローカルファイルは読んでいないため、secret scan / dependency graph / file card生成は実行していません。
ユーザーの許可はスキャン対象に含めるための許可であり、secretをLLMへそのまま送る許可ではありません。
`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n...(truncated)`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
