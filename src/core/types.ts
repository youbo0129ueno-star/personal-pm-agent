export type CollectedItemType =
  | "project"
  | "task"
  | "note"
  | "person"
  | "git"
  | "github_issue"
  | "repository"
  | "previous_report";

export type CollectedItem = {
  source: string;
  type: CollectedItemType;
  title: string;
  body: string;
  url?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
};

export type RepositoryLink = {
  id: string;
  name?: string;
  path: string;
  project?: string;
};

export type ContextPack = {
  date: string;
  workspace: {
    name: string;
    path: string;
  };
  projects: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  people: Array<Record<string, unknown>>;
  recent_logs: Array<Record<string, unknown>>;
  repositories: Array<Record<string, unknown>>;
  github_issues?: Array<Record<string, unknown>>;
  previous_report?: Record<string, unknown> | null;
  collected_items: number;
};
