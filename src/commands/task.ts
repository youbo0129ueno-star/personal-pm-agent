import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseGitHubRepoFullName } from "../core/github.js";
import { expandHome } from "../core/git.js";
import { parseRepositoryLinks } from "../core/markdown.js";

const TASK_LISTS = ["active", "waiting", "delegated", "backlog", "done"] as const;
const execFileAsync = promisify(execFile);
type TaskList = (typeof TASK_LISTS)[number];

export type TaskCommandOptions = {
  list?: string;
  title?: string;
  from?: string;
  to?: string;
  repo?: string;
  source?: string;
  scope?: string;
  apply?: boolean;
  id?: string;
  number?: string;
};

type TaskCandidate = {
  id: string;
  repo: string;
  source: "git_status" | "todo" | "github_issue" | "github_pr";
  title: string;
  detail: string;
  url?: string;
  file?: string;
  line?: number;
};

type GitHubIssue = {
  number: number;
  title: string;
  url: string;
  body?: string;
  state?: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
};

type IssueSplitTask = {
  title: string;
  body: string;
};

type GitHubPullRequest = {
  number: number;
  title: string;
  url: string;
  labels?: Array<{ name?: string }>;
  author?: { login?: string };
};

type GitHubRepository = {
  id: string;
  fullName: string;
};

type GitHubRepoListItem = {
  name: string;
  nameWithOwner: string;
};

export async function taskCommand(
  targetDir: string,
  action: string | undefined,
  options: TaskCommandOptions
): Promise<string> {
  if (action === "add") {
    return addTask(targetDir, assertTaskList(options.list ?? "active"), requireOption(options.title, "--title"), options.repo);
  }

  if (action === "move") {
    return moveTask(
      targetDir,
      assertTaskList(requireOption(options.from, "--from")),
      assertTaskList(requireOption(options.to, "--to")),
      requireOption(options.title, "--title")
    );
  }

  if (action === "list") {
    return listTasks(targetDir, options.list ? assertTaskList(options.list) : undefined);
  }

  if (action === "discover") {
    return discoverTasks(targetDir, options.repo, options.source, options.scope);
  }

  if (action === "import") {
    return importTaskCandidate(targetDir, assertTaskList(options.list ?? "active"), options);
  }

  if (action === "split-issue") {
    return splitIssue(targetDir, options);
  }

  throw new Error(`Unknown task action: ${action ?? "(missing)"}. Expected add, move, list, discover, import, or split-issue.`);
}

async function addTask(targetDir: string, list: TaskList, title: string, repo?: string): Promise<string> {
  const file = taskFile(targetDir, list);
  const markdown = await readTaskFile(file, list);
  if (findTaskLine(markdown, title)) {
    throw new Error(`Task already exists in ${list}: ${title}`);
  }

  const marker = list === "done" ? "x" : " ";
  const metadata = repo ? ` <!-- repo:${repo} -->` : "";
  const next = appendChecklistItem(markdown, `- [${marker}] ${title}${metadata}`);
  await writeFile(file, next, "utf8");
  return `Added task to ${list}${repo ? ` for ${repo}` : ""}: ${title}`;
}

async function moveTask(targetDir: string, from: TaskList, to: TaskList, title: string): Promise<string> {
  if (from === to) {
    throw new Error("--from and --to must be different lists.");
  }

  const fromFile = taskFile(targetDir, from);
  const toFile = taskFile(targetDir, to);
  const fromMarkdown = await readTaskFile(fromFile, from);
  const toMarkdown = await readTaskFile(toFile, to);
  const found = findTaskLine(fromMarkdown, title);

  if (!found) {
    throw new Error(`Task not found in ${from}: ${title}`);
  }
  if (findTaskLine(toMarkdown, title)) {
    throw new Error(`Task already exists in ${to}: ${title}`);
  }

  const nextFrom = removeTaskLine(fromMarkdown, found.line);
  const marker = to === "done" ? "x" : " ";
  const nextTo = appendChecklistItem(toMarkdown, `- [${marker}] ${title}`);

  await writeFile(fromFile, nextFrom, "utf8");
  await writeFile(toFile, nextTo, "utf8");
  return `Moved task from ${from} to ${to}: ${title}`;
}

async function listTasks(targetDir: string, list?: TaskList): Promise<string> {
  const lists = list ? [list] : [...TASK_LISTS];
  const sections: string[] = [];

  for (const taskList of lists) {
    const file = taskFile(targetDir, taskList);
    const markdown = await readTaskFile(file, taskList);
    const tasks = markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^- \[[ xX]\]/.test(line));
    sections.push(`## ${taskList}\n${tasks.length > 0 ? tasks.join("\n") : "- (none)"}`);
  }

  return sections.join("\n\n");
}

async function discoverTasks(targetDir: string, repoFilter?: string, source = "local", scope = "mine"): Promise<string> {
  const repositoriesFile = path.join(targetDir, "links/repositories.md");
  const markdown = existsSync(repositoriesFile) ? await readFile(repositoriesFile, "utf8") : "";
  const repositories = parseRepositoryLinks(markdown).filter((repo) => !repoFilter || repo.id === repoFilter);
  const candidates: TaskCandidate[] = [];
  const normalizedSource = assertDiscoverySource(source);
  const normalizedScope = assertDiscoveryScope(scope);

  if (normalizedSource === "github") {
    const githubRepositories = await resolveGitHubDiscoveryRepositories(
      parseRepositoryLinks(markdown),
      repoFilter
    );

    for (const repo of githubRepositories) {
      candidates.push(...(await discoverGitHubCandidates(repo, normalizedScope)));
    }

    await writeCandidates(targetDir, candidates);
    if (candidates.length === 0) {
      return "No GitHub task candidates found.";
    }

    return candidates
      .map((candidate, index) => `${index + 1}. [${candidate.id}] ${candidate.title}\n   ${candidate.detail}`)
      .join("\n");
  }

  if (repoFilter && repositories.length === 0) {
    throw new Error(`Repository not found in links/repositories.md: ${repoFilter}`);
  }

  for (const repo of repositories) {
    if (!repo.id) continue;
    if (!repo.path) continue;
    const repoPath = expandHome(repo.path);
    candidates.push(...(await discoverGitStatusCandidates(repo.id, repoPath)));
    candidates.push(...(await discoverTodoCandidates(repo.id, repoPath)));
  }

  await writeCandidates(targetDir, candidates);
  if (candidates.length === 0) {
    return "No local task candidates found.";
  }

  return candidates
    .map((candidate, index) => `${index + 1}. [${candidate.id}] ${candidate.title}\n   ${candidate.detail}`)
    .join("\n");
}

async function discoverGitHubCandidates(repo: GitHubRepository, scope: "mine" | "all"): Promise<TaskCandidate[]> {
  try {
    const [issues, pullRequests] = scope === "mine"
      ? await Promise.all([
          ghJson<GitHubIssue[]>(["issue", "list", "--repo", repo.fullName, "--state", "open", "--assignee", "@me", "--json", "number,title,url,labels,assignees"]),
          ghPrMine(repo.fullName)
        ])
      : await Promise.all([
          ghJson<GitHubIssue[]>(["issue", "list", "--repo", repo.fullName, "--state", "open", "--json", "number,title,url,labels,assignees"]),
          ghJson<GitHubPullRequest[]>(["pr", "list", "--repo", repo.fullName, "--state", "open", "--json", "number,title,url,labels,author"])
        ]);

    return [
      ...issues.map((issue) => ({
        id: `${repo.id}:issue:${issue.number}`,
        repo: repo.id,
        source: "github_issue" as const,
        title: `Issue #${issue.number}: ${issue.title}`,
        detail: formatGitHubIssueDetail(issue),
        url: issue.url
      })),
      ...pullRequests.map((pullRequest) => ({
        id: `${repo.id}:pr:${pullRequest.number}`,
        repo: repo.id,
        source: "github_pr" as const,
        title: `Review PR #${pullRequest.number}: ${pullRequest.title}`,
        detail: formatGitHubPullRequestDetail(pullRequest),
        url: pullRequest.url
      }))
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub discovery failed for ${repo.fullName}. Check \`gh auth status\` and repository access. ${message}`);
  }
}

async function ghPrMine(fullName: string): Promise<GitHubPullRequest[]> {
  const [authored, reviewRequested] = await Promise.all([
    ghJson<GitHubPullRequest[]>(["pr", "list", "--repo", fullName, "--state", "open", "--author", "@me", "--json", "number,title,url,labels,author"]),
    ghJson<GitHubPullRequest[]>(["pr", "list", "--repo", fullName, "--state", "open", "--search", "review-requested:@me", "--json", "number,title,url,labels,author"])
  ]);
  return uniquePullRequests([...authored, ...reviewRequested]);
}

function uniquePullRequests(pullRequests: GitHubPullRequest[]): GitHubPullRequest[] {
  const seen = new Set<number>();
  return pullRequests.filter((pullRequest) => {
    if (seen.has(pullRequest.number)) return false;
    seen.add(pullRequest.number);
    return true;
  });
}

async function resolveGitHubDiscoveryRepositories(
  linkedRepositories: Array<Record<string, string>>,
  repoFilter?: string
): Promise<GitHubRepository[]> {
  if (repoFilter) {
    const linked = linkedRepositories.find((repo) => repo.id === repoFilter || repo.github === repoFilter || repo.full_name === repoFilter);
    if (linked) {
      const fullName = await resolveGitHubRepoFullName(linked);
      if (!fullName) {
        throw new Error(
          `Could not resolve GitHub repository for ${repoFilter}. Add github: owner/name to links/repositories.md or set an origin remote.`
        );
      }
      return [{ id: linked.id ?? repoFilter, fullName }];
    }

    const githubRepo = await resolveGitHubRepositoryFromAccount(repoFilter);
    if (githubRepo) return [githubRepo];
    throw new Error(`GitHub repository not found: ${repoFilter}`);
  }

  return listGitHubRepositoriesFromAccount();
}

async function resolveGitHubRepoFullName(repo: Record<string, string>): Promise<string | null> {
  if (repo.github) return repo.github;
  if (repo.full_name) return repo.full_name;
  if (repo.id?.includes("/")) return repo.id;
  if (!repo.path) return null;

  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: expandHome(repo.path),
      maxBuffer: 1024 * 1024
    });
    return parseGitHubRepoFullName(stdout);
  } catch {
    return null;
  }
}

async function resolveGitHubRepositoryFromAccount(repoFilter: string): Promise<GitHubRepository | null> {
  if (repoFilter.includes("/")) {
    return { id: repoFilter.split("/").at(-1) ?? repoFilter, fullName: repoFilter };
  }

  const repositories = await listGitHubRepositoriesFromAccount();
  return repositories.find((repo) => repo.id === repoFilter || repo.fullName === repoFilter) ?? null;
}

async function listGitHubRepositoriesFromAccount(): Promise<GitHubRepository[]> {
  const user = await ghJson<{ login: string }>(["api", "user"]);
  const repositories = await ghJson<GitHubRepoListItem[]>([
    "repo",
    "list",
    user.login,
    "--limit",
    "100",
    "--json",
    "name,nameWithOwner"
  ]);

  return repositories.map((repo) => ({
    id: repo.name,
    fullName: repo.nameWithOwner
  }));
}

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

function formatGitHubIssueDetail(issue: GitHubIssue): string {
  const labels = (issue.labels ?? []).map((label) => label.name).filter(Boolean).join(", ") || "none";
  const assignees = (issue.assignees ?? []).map((assignee) => assignee.login).filter(Boolean).join(", ") || "unassigned";
  return `${issue.url} | labels: ${labels} | assignees: ${assignees}`;
}

function formatGitHubPullRequestDetail(pullRequest: GitHubPullRequest): string {
  const labels = (pullRequest.labels ?? []).map((label) => label.name).filter(Boolean).join(", ") || "none";
  const author = pullRequest.author?.login ?? "unknown";
  return `${pullRequest.url} | labels: ${labels} | author: ${author}`;
}

function assertDiscoverySource(source: string): "local" | "github" {
  if (source === "local" || source === "github") return source;
  throw new Error(`Unknown discovery source: ${source}. Expected local or github.`);
}

function assertDiscoveryScope(scope: string): "mine" | "all" {
  if (scope === "mine" || scope === "all") return scope;
  throw new Error(`Unknown discovery scope: ${scope}. Expected mine or all.`);
}

async function importTaskCandidate(targetDir: string, list: TaskList, options: TaskCommandOptions): Promise<string> {
  const candidates = await readCandidates(targetDir);
  const candidate = selectCandidate(candidates, options);
  if (!candidate) {
    throw new Error("Task candidate not found. Run `pm-agent task <ledger-dir> discover` first.");
  }

  await addTask(targetDir, list, candidate.title);
  return `Imported candidate to ${list}: ${candidate.title}`;
}

async function splitIssue(targetDir: string, options: TaskCommandOptions): Promise<string> {
  const repoFilter = requireOption(options.repo, "--repo");
  const issueNumber = requireOption(options.number, "--number");
  const repositoriesFile = path.join(targetDir, "links/repositories.md");
  const markdown = existsSync(repositoriesFile) ? await readFile(repositoriesFile, "utf8") : "";
  const [repo] = await resolveGitHubDiscoveryRepositories(parseRepositoryLinks(markdown), repoFilter);
  const issue = await ghJson<GitHubIssue>([
    "issue",
    "view",
    issueNumber,
    "--repo",
    repo.fullName,
    "--json",
    "number,title,body,url,state,labels,assignees"
  ]);

  if (issue.state && issue.state !== "OPEN") {
    return `Issue #${issue.number} is ${issue.state}. Split only open issues.`;
  }

  const splitTasks = buildIssueSplitPlan(issue);
  if (splitTasks.length === 0) {
    return `No split tasks found for Issue #${issue.number}: ${issue.title}`;
  }

  if (!options.apply) {
    return [
      `Dry run: Issue #${issue.number} would be split into ${splitTasks.length} child issues.`,
      `Parent: ${issue.title}`,
      "",
      ...splitTasks.map((task, index) => `${index + 1}. ${task.title}`),
      "",
      "Run again with --apply to create these GitHub Issues."
    ].join("\n");
  }

  const createdUrls: string[] = [];
  for (const task of splitTasks) {
    const { stdout } = await execFileAsync("gh", ["issue", "create", "--repo", repo.fullName, "--title", task.title, "--body", task.body], {
      maxBuffer: 1024 * 1024
    });
    createdUrls.push(stdout.trim());
  }

  await execFileAsync("gh", [
    "issue",
    "comment",
    String(issue.number),
    "--repo",
    repo.fullName,
    "--body",
    ["Split into child issues:", ...createdUrls.map((url) => `- ${url}`)].join("\n")
  ]);

  return [
    `Created ${createdUrls.length} child issues from Issue #${issue.number}: ${issue.title}`,
    ...createdUrls.map((url, index) => `${index + 1}. ${url}`)
  ].join("\n");
}

function buildIssueSplitPlan(issue: GitHubIssue): IssueSplitTask[] {
  const checklistItems = extractUncheckedChecklistItems(issue.body ?? "");
  const titles = checklistItems.length > 0 ? checklistItems : defaultIssueSplitTitles(issue.title);
  return titles.map((title, index) => ({
    title,
    body: buildChildIssueBody(issue, title, index + 1)
  }));
}

function extractUncheckedChecklistItems(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+\[ \]\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item))
    .map((item) => item.replace(/\s*<!--.*?-->\s*$/, "").trim())
    .filter(Boolean);
}

function defaultIssueSplitTitles(parentTitle: string): string[] {
  return [
    `${parentTitle}: 要件と完了条件を確認する`,
    `${parentTitle}: 実装方針を決める`,
    `${parentTitle}: 最小実装を行う`,
    `${parentTitle}: 動作確認とレビュー観点を整理する`
  ];
}

function buildChildIssueBody(issue: GitHubIssue, title: string, index: number): string {
  return [
    `Parent: #${issue.number}`,
    `Source: ${issue.url}`,
    "",
    "## Scope",
    title,
    "",
    "## Done",
    "- [ ] 完了条件を満たしている",
    "- [ ] 親Issueに進捗を戻せる状態になっている",
    "",
    "## Notes",
    `Generated by Personal PM Agent split-issue (${index}).`
  ].join("\n");
}

async function discoverGitStatusCandidates(repoId: string, repoPath: string): Promise<TaskCandidate[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024
    });
    return stdout
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(0, 20)
      .map((line, index) => {
        const file = line.slice(3).trim();
        return {
          id: `${repoId}:git:${index + 1}`,
          repo: repoId,
          source: "git_status" as const,
          title: `Review ${file} changes in ${repoId}`,
          detail: line,
          file
        };
      });
  } catch {
    return [];
  }
}

async function discoverTodoCandidates(repoId: string, repoPath: string): Promise<TaskCandidate[]> {
  try {
    const { stdout } = await execFileAsync("rg", ["-n", "(//|#|<!--|/\\*)\\s*(TODO|FIXME|HACK|XXX)", "."], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((line, index) => {
        const [file = "unknown", lineNumber = "0", ...rest] = line.split(":");
        const text = rest.join(":").trim();
        return {
          id: `${repoId}:todo:${index + 1}`,
          repo: repoId,
          source: "todo" as const,
          title: `Resolve TODO in ${repoId}/${file}:${lineNumber}`,
          detail: text,
          file,
          line: Number(lineNumber)
        };
      });
  } catch {
    return [];
  }
}

async function writeCandidates(targetDir: string, candidates: TaskCandidate[]): Promise<void> {
  const file = candidatesFile(targetDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ generated_at: new Date().toISOString(), candidates }, null, 2)}\n`, "utf8");
}

async function readCandidates(targetDir: string): Promise<TaskCandidate[]> {
  const file = candidatesFile(targetDir);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(await readFile(file, "utf8")) as { candidates?: TaskCandidate[] };
  return parsed.candidates ?? [];
}

function selectCandidate(candidates: TaskCandidate[], options: TaskCommandOptions): TaskCandidate | undefined {
  if (options.id) {
    return candidates.find((candidate) => candidate.id === options.id);
  }
  if (options.number) {
    const index = Number(options.number) - 1;
    return candidates[index];
  }
  throw new Error("Missing required option: --id or --number");
}

function findTaskLine(markdown: string, title: string): { line: string; index: number } | null {
  const lines = markdown.split(/\r?\n/);
  const normalizedTitle = normalizeTaskTitle(title);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^- \[[ xX]\]/.test(line.trim())) continue;
    if (normalizeTaskTitle(line) === normalizedTitle) {
      return { line, index };
    }
  }

  return null;
}

function removeTaskLine(markdown: string, lineToRemove: string): string {
  const lines = markdown.split(/\r?\n/);
  const index = lines.findIndex((line) => line === lineToRemove);
  if (index === -1) return markdown;
  lines.splice(index, 1);
  return ensureTrailingNewline(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function appendChecklistItem(markdown: string, item: string): string {
  const trimmed = markdown.trimEnd();
  return `${trimmed}${trimmed ? "\n" : ""}${item}\n`;
}

async function readTaskFile(file: string, list: TaskList): Promise<string> {
  if (!existsSync(file)) {
    return `# ${titleForList(list)}\n\n`;
  }
  return readFile(file, "utf8");
}

function normalizeTaskTitle(value: string): string {
  return value.replace(/^- \[[ xX]\]\s*/, "").replace(/\s*<!--\s*repo:[^>]+-->\s*$/, "").trim();
}

function taskFile(targetDir: string, list: TaskList): string {
  return path.join(targetDir, "tasks", `${list}.md`);
}

function candidatesFile(targetDir: string): string {
  return path.join(targetDir, "tasks", "candidates.json");
}

function assertTaskList(value: string): TaskList {
  if (TASK_LISTS.includes(value as TaskList)) return value as TaskList;
  throw new Error(`Invalid task list: ${value}. Expected one of ${TASK_LISTS.join(", ")}.`);
}

function requireOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required option: ${name}`);
  return value;
}

function titleForList(list: TaskList): string {
  return `${list[0].toUpperCase()}${list.slice(1)} Tasks`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
