import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { ensureDir } from "../core/fs.js";
import { parseRepositoryLinks } from "../core/markdown.js";

const execFileAsync = promisify(execFile);

export type RepositoryCommandOptions = {
  repo?: string;
};

type RegisteredRepository = Record<string, string>;

type GitHubRepoListItem = {
  name: string;
  nameWithOwner: string;
  description?: string;
  isPrivate?: boolean;
  owner?: { login?: string };
};

export async function repositoryCommand(
  targetDir: string,
  action: string | undefined,
  options: RepositoryCommandOptions
): Promise<string> {
  if (action === "activate") {
    return activateRepository(targetDir, requireRepo(options.repo));
  }

  if (action === "deactivate") {
    return deactivateRepository(targetDir, requireRepo(options.repo));
  }

  if (action === "active") {
    return listActiveRepositories(targetDir);
  }

  if (action === "list") {
    return listRegisteredRepositories(targetDir);
  }

  if (action === "register") {
    const repo = await registerGitHubRepository(targetDir, requireRepo(options.repo));
    return [
      `Registered repository: ${repo.id}`,
      `- github: ${repo.github}`,
      "",
      "Next:",
      `- Run /activate-repo ${repo.id}`
    ].join("\n");
  }

  throw new Error(`Unknown repository action: ${action ?? "(missing)"}. Expected activate, deactivate, active, list, or register.`);
}

export async function readExplicitActiveRepositoryIds(targetDir: string): Promise<string[]> {
  const markdown = await readActiveRepositoriesFile(targetDir);
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^- \[[ xX]\]\s*/, "- "))
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .map((line) => line.split(/\s+#/)[0].trim())
    .filter(Boolean);
}

async function activateRepository(targetDir: string, repoId: string): Promise<string> {
  const repositories = await readRegisteredRepositories(targetDir);
  let repo = repositories.find((candidate) => candidate.id === repoId);
  if (!repo) {
    repo = await registerGitHubRepository(targetDir, repoId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Repository not found in links/repositories.md: ${repoId}\nTried GitHub auto-registration but failed. ${message}\n\nRun /repos to see registered repositories, or /register-repo <repo-id> to register one.`);
    });
  }

  const activeIds = new Set(await readExplicitActiveRepositoryIds(targetDir));
  if (activeIds.has(repoId)) {
    return `Repository is already active: ${repoId}`;
  }

  const file = activeRepositoriesPath(targetDir);
  const current = await readActiveRepositoriesFile(targetDir);
  const next = appendActiveRepository(current, repo);
  await ensureDir(path.dirname(file));
  await writeFile(file, next, "utf8");

  return [
    `Activated repository: ${repoId}`,
    "",
    "Next:",
    "- Run /understand-active to build repository context.",
    "- Run /dashboard repositories to inspect it."
  ].join("\n");
}

async function deactivateRepository(targetDir: string, repoId: string): Promise<string> {
  const file = activeRepositoriesPath(targetDir);
  const current = await readActiveRepositoriesFile(targetDir);
  const lines = current.split(/\r?\n/);
  const nextLines = lines.filter((line) => !line.trim().match(new RegExp(`^- (?:\\[[ xX]\\] )?${escapeRegExp(repoId)}(?:\\s|$)`)));
  await ensureDir(path.dirname(file));
  await writeFile(file, normalizeMarkdown(nextLines.join("\n")), "utf8");
  return `Deactivated repository: ${repoId}`;
}

async function listActiveRepositories(targetDir: string): Promise<string> {
  const ids = await readExplicitActiveRepositoryIds(targetDir);
  if (ids.length === 0) {
    return [
      "No explicitly active repositories.",
      "",
      "Activate one with:",
      "/activate-repo <repo-id>"
    ].join("\n");
  }
  return ["Explicitly active repositories:", "", ...ids.map((id) => `- ${id}`)].join("\n");
}

async function listRegisteredRepositories(targetDir: string): Promise<string> {
  const repositories = await readRegisteredRepositories(targetDir);
  if (repositories.length === 0) {
    return [
      "No repositories registered.",
      "",
      "Register repositories with setup --select-repos or:",
      "/register-repo <repo-id>"
    ].join("\n");
  }

  const activeIds = new Set(await readExplicitActiveRepositoryIds(targetDir));
  return [
    "Registered repositories:",
    "",
    ...repositories.map((repo) => {
      const active = activeIds.has(repo.id) ? " active" : "";
      const source = repo.github ?? repo.path ?? "";
      return `- ${repo.id}${active}${source ? ` (${source})` : ""}`;
    })
  ].join("\n");
}

async function readRegisteredRepositories(targetDir: string): Promise<RegisteredRepository[]> {
  const file = path.join(targetDir, "links/repositories.md");
  const markdown = existsSync(file) ? await readFile(file, "utf8") : "";
  return parseRepositoryLinks(markdown).filter((repo) => repo.id);
}

async function registerGitHubRepository(targetDir: string, repoIdOrFullName: string): Promise<RegisteredRepository> {
  const existing = (await readRegisteredRepositories(targetDir)).find((repo) => repo.id === repoIdOrFullName || repo.github === repoIdOrFullName);
  if (existing) return existing;

  const githubRepo = await resolveGitHubRepository(repoIdOrFullName);
  const repo: RegisteredRepository = {
    id: githubRepo.name,
    name: githubRepo.name,
    github: githubRepo.nameWithOwner,
    scope: githubRepo.owner?.login === githubRepo.nameWithOwner.split("/")[0] ? "owned" : "accessible"
  };

  await appendRepositoryLink(targetDir, repo);
  await appendRepositoryContext(targetDir, repo, githubRepo);
  return repo;
}

async function resolveGitHubRepository(repoIdOrFullName: string): Promise<GitHubRepoListItem> {
  if (repoIdOrFullName.includes("/")) {
    const repo = await ghJson<GitHubRepoListItem>(["repo", "view", repoIdOrFullName, "--json", "name,nameWithOwner,description,isPrivate,owner"]);
    return repo;
  }

  const repositories = await ghJson<GitHubRepoListItem[]>(["repo", "list", "--limit", "300", "--json", "name,nameWithOwner,description,isPrivate,owner"]);
  const match = repositories.find((repo) => repo.name === repoIdOrFullName || repo.name.toLowerCase() === repoIdOrFullName.toLowerCase());
  if (!match) {
    throw new Error(`GitHub repository not found or not accessible: ${repoIdOrFullName}`);
  }
  return match;
}

async function appendRepositoryLink(targetDir: string, repo: RegisteredRepository): Promise<void> {
  const file = path.join(targetDir, "links/repositories.md");
  const current = existsSync(file) ? await readFile(file, "utf8") : "# Repositories\n\n";
  if (current.includes(`github: ${repo.github}`) || current.includes(`- id: ${repo.id}\n`)) return;
  const addition = `- id: ${repo.id}
  name: ${repo.name ?? repo.id}
  github: ${repo.github}
  scope: ${repo.scope ?? "accessible"}
`;
  await ensureDir(path.dirname(file));
  await writeFile(file, `${current.trimEnd()}\n\n${addition}`, "utf8");
}

async function appendRepositoryContext(targetDir: string, repo: RegisteredRepository, githubRepo: GitHubRepoListItem): Promise<void> {
  const file = path.join(targetDir, "context/repositories.md");
  const current = existsSync(file) ? await readFile(file, "utf8") : "# Repository Context\n\n";
  if (current.includes(`- github: ${repo.github}`)) return;
  const addition = `## ${repo.id}

- github: ${repo.github}
- scope: ${repo.scope ?? "accessible"}
- visibility: ${githubRepo.isPrivate ? "private" : "public"}
- description: ${githubRepo.description || "なし"}

### PM Handling

- status: candidate
- notes: /register-repo または /activate-repo で追加されたrepo。
`;
  await ensureDir(path.dirname(file));
  await writeFile(file, `${current.trimEnd()}\n\n${addition}`, "utf8");
}

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("gh", args);
  return JSON.parse(stdout) as T;
}

async function readActiveRepositoriesFile(targetDir: string): Promise<string> {
  const file = activeRepositoriesPath(targetDir);
  if (!existsSync(file)) return "# Active Repositories\n\n";
  return readFile(file, "utf8");
}

function activeRepositoriesPath(targetDir: string): string {
  return path.join(targetDir, "context/active-repositories.md");
}

function appendActiveRepository(markdown: string, repo: RegisteredRepository): string {
  const entry = `- ${repo.id}${repo.name ? ` # ${repo.name}` : ""}`;
  return normalizeMarkdown(`${markdown.trim()}\n${entry}\n`);
}

function normalizeMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  return `${trimmed || "# Active Repositories"}\n`;
}

function requireRepo(value: string | undefined): string {
  if (!value) throw new Error("Missing repo id.");
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
