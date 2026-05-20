import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { ensureDir } from "../core/fs.js";
import { parseRepositoryLinks } from "../core/markdown.js";

export type RepositoryCommandOptions = {
  repo?: string;
};

type RegisteredRepository = Record<string, string>;

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

  throw new Error(`Unknown repository action: ${action ?? "(missing)"}. Expected activate, deactivate, or active.`);
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
  const repo = repositories.find((candidate) => candidate.id === repoId);
  if (!repo) {
    throw new Error(`Repository not found in links/repositories.md: ${repoId}`);
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

async function readRegisteredRepositories(targetDir: string): Promise<RegisteredRepository[]> {
  const file = path.join(targetDir, "links/repositories.md");
  const markdown = existsSync(file) ? await readFile(file, "utf8") : "";
  return parseRepositoryLinks(markdown).filter((repo) => repo.id);
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
