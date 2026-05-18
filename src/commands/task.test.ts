import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initCommand } from "./init.js";
import { taskCommand } from "./task.js";

test("task add appends a checklist item to the selected list", async () => {
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-ledger-"));
  await initCommand(ledgerDir);

  await taskCommand(ledgerDir, "add", {
    list: "active",
    title: "新しいタスクを登録する"
  });

  const active = await readFile(path.join(ledgerDir, "tasks/active.md"), "utf8");
  assert.match(active, /- \[ \] 新しいタスクを登録する/);
});

test("task add can attach repository metadata", async () => {
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-ledger-"));
  await initCommand(ledgerDir);

  await taskCommand(ledgerDir, "add", {
    list: "active",
    title: "READMEの導入を直す",
    repo: "study-forge"
  });

  const active = await readFile(path.join(ledgerDir, "tasks/active.md"), "utf8");
  assert.match(active, /- \[ \] READMEの導入を直す <!-- repo:study-forge -->/);
});

test("task move moves an item and marks done tasks checked", async () => {
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-ledger-"));
  await initCommand(ledgerDir);

  await taskCommand(ledgerDir, "add", {
    list: "active",
    title: "移動するタスク"
  });
  await taskCommand(ledgerDir, "move", {
    from: "active",
    to: "done",
    title: "移動するタスク"
  });

  const active = await readFile(path.join(ledgerDir, "tasks/active.md"), "utf8");
  const done = await readFile(path.join(ledgerDir, "tasks/done.md"), "utf8");
  assert.doesNotMatch(active, /移動するタスク/);
  assert.match(done, /- \[x\] 移動するタスク/);
});

test("task import adds a previously discovered candidate", async () => {
  const ledgerDir = await mkdtemp(path.join(os.tmpdir(), "pm-agent-ledger-"));
  await initCommand(ledgerDir);
  await import("node:fs/promises").then(({ mkdir, writeFile }) =>
    mkdir(path.join(ledgerDir, "tasks"), { recursive: true }).then(() =>
      writeFile(
        path.join(ledgerDir, "tasks/candidates.json"),
        JSON.stringify({
          candidates: [
            {
              id: "repo:todo:1",
              repo: "repo",
              source: "todo",
              title: "Resolve TODO in repo/src/index.ts:1",
              detail: "TODO: implement"
            }
          ]
        })
      )
    )
  );

  await taskCommand(ledgerDir, "import", {
    number: "1",
    list: "active"
  });

  const active = await readFile(path.join(ledgerDir, "tasks/active.md"), "utf8");
  assert.match(active, /Resolve TODO in repo\/src\/index.ts:1/);
});
