#!/usr/bin/env node
// Static consistency check for the n8n workflow templates in integrations/n8n (no n8n needed).
//
// Verifies that every template:
//   1. parses as JSON and has a name, a nodes array and a connections object,
//   2. has unique node names and ids,
//   3. only references existing nodes in `connections` (sources and targets) and in
//      `$('Node name')` / `$node["Node name"]` expressions,
//   4. reads only namespaced env vars (`$env.SB_*`) or n8n-global ones, so it can share an
//      n8n instance with other apps,
//   5. uses webhook paths prefixed with `second-brain-` and credential names starting with
//      "Second Brain",
//   6. has no hard-coded api.openai.com URL (the AI host comes from SB_AI_BASE_URL).
//
// Usage: node scripts/check-n8n.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "integrations/n8n";
const GLOBAL_ENV = new Set(["GENERIC_TIMEZONE", "N8N_BLOCK_ENV_ACCESS_IN_NODE", "WEBHOOK_URL"]);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const errors = [];
const webhookIds = new Map();

for (const file of files) {
  const err = (msg) => errors.push(`${file}: ${msg}`);
  const raw = readFileSync(join(dir, file), "utf8");
  let wf;
  try {
    wf = JSON.parse(raw);
  } catch (e) {
    err(`invalid JSON (${e.message})`);
    continue;
  }
  if (!wf.name || !Array.isArray(wf.nodes) || typeof wf.connections !== "object") {
    err("missing name, nodes or connections");
    continue;
  }

  const names = new Set();
  const ids = new Set();
  for (const node of wf.nodes) {
    if (names.has(node.name)) err(`duplicate node name "${node.name}"`);
    if (node.id && ids.has(node.id)) err(`duplicate node id "${node.id}"`);
    names.add(node.name);
    ids.add(node.id);

    for (const [type, cred] of Object.entries(node.credentials ?? {})) {
      if (!String(cred?.name ?? "").startsWith("Second Brain")) {
        err(
          `node "${node.name}": credential ${type} "${cred?.name}" must start with "Second Brain"`,
        );
      }
    }
    const path = node.parameters?.path;
    if (node.type === "n8n-nodes-base.webhook" && !String(path).startsWith("second-brain-")) {
      err(`node "${node.name}": webhook path "${path}" must start with "second-brain-"`);
    }
    if (node.webhookId) {
      const seen = webhookIds.get(node.webhookId);
      if (seen) err(`node "${node.name}": webhookId also used in ${seen}`);
      webhookIds.set(node.webhookId, `${file} / ${node.name}`);
    }
  }

  for (const [source, outputs] of Object.entries(wf.connections)) {
    if (!names.has(source)) err(`connection from unknown node "${source}"`);
    for (const branches of Object.values(outputs)) {
      for (const branch of branches ?? []) {
        for (const link of branch ?? []) {
          if (!names.has(link.node)) err(`connection "${source}" → unknown node "${link.node}"`);
        }
      }
    }
  }

  // $('Name') and $node["Name"] references inside expressions / code (as stored in JSON).
  const nodeRef = /\$\(\s*'((?:[^'\\]|\\.)+)'\s*\)|\$node\[\\"((?:[^"\\]|\\.)+?)\\"\]/g;
  for (const m of raw.matchAll(nodeRef)) {
    const ref = (m[1] ?? m[2]).replace(/\\(.)/g, "$1");
    if (!names.has(ref)) err(`expression references unknown node "${ref}"`);
  }

  for (const m of raw.matchAll(/\$env\.([A-Za-z0-9_]+)/g)) {
    if (!m[1].startsWith("SB_") && !GLOBAL_ENV.has(m[1])) {
      err(`$env.${m[1]} is not namespaced (use SB_${m[1]})`);
    }
  }
  for (const node of wf.nodes) {
    if (node.type === "n8n-nodes-base.stickyNote") continue;
    const p = node.parameters ?? {};
    // Code comments may mention OpenAI as an alternative; executable code and URLs may not.
    const code = String(p.jsCode ?? "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    if (/api\.openai\.com/.test(`${p.url ?? ""}\n${code}`)) {
      err(`node "${node.name}": hard-coded api.openai.com (use SB_AI_BASE_URL)`);
    }
    if (node.credentials?.openAiApi || p.nodeCredentialType === "openAiApi") {
      err(`node "${node.name}": uses the OpenAI credential type (use Header Auth)`);
    }
  }
}

if (errors.length) {
  console.error(`n8n template check failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`n8n templates OK (${files.length} workflows)`);
