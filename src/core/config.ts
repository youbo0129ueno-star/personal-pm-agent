import path from "node:path";
import { readTextIfExists } from "./fs.js";

export type AdapterConfig =
  | {
      type: "mock";
    }
  | {
      type: "agent";
      command: string;
      args?: string[];
      promptMode?: "stdin" | "argument";
      timeoutMs?: number;
      allowedOutputs?: string[];
      saveLog?: boolean;
    };

export type PmAgentConfig = {
  model?: {
    defaultAdapter?: string;
    adapters?: Record<string, AdapterConfig>;
  };
  collect?: {
    projects?: { enabled?: boolean };
    tasks?: { enabled?: boolean };
    dailyLogs?: { enabled?: boolean; days?: number };
    people?: { enabled?: boolean };
    repositories?: { enabled?: boolean; includeGitStatus?: boolean };
    githubIssues?: { enabled?: boolean; limit?: number };
    previousReport?: { enabled?: boolean };
  };
  agentLogs?: {
    save?: boolean;
    gitIgnore?: boolean;
  };
};

export async function loadConfig(ledgerDir: string): Promise<PmAgentConfig> {
  const file = path.join(ledgerDir, "pm-agent.config.json");
  const text = await readTextIfExists(file);
  if (!text) return {};
  return JSON.parse(text) as PmAgentConfig;
}

export function resolveAdapterConfig(config: PmAgentConfig, adapterName?: string): {
  name: string;
  config: AdapterConfig;
} {
  const name = adapterName ?? config.model?.defaultAdapter ?? "mock";
  const adapterConfig = config.model?.adapters?.[name] ?? (name === "mock" ? { type: "mock" as const } : undefined);
  if (!adapterConfig) {
    throw new Error(`Adapter not configured: ${name}`);
  }
  return { name, config: adapterConfig };
}
