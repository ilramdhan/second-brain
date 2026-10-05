#!/usr/bin/env node
// Static consistency check for drizzle/migrations (no database needed).
//
// Verifies that:
//   1. every entry in meta/_journal.json has a matching NNNN_tag.sql file,
//   2. every .sql file is registered in the journal,
//   3. journal indexes are contiguous (0..n-1), match the file prefix and
//      `when` timestamps are strictly increasing,
//   4. no migration file is empty.
//
// Usage: node scripts/check-migrations.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = "drizzle/migrations";
const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
const sqlFiles = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const errors = [];

const tags = new Set();
let prevWhen = -Infinity;
journal.entries.forEach((entry, i) => {
  if (entry.idx !== i) errors.push(`journal entry #${i} has idx ${entry.idx} (expected ${i})`);
  const prefix = String(entry.idx).padStart(4, "0");
  if (!entry.tag.startsWith(`${prefix}_`)) {
    errors.push(`journal tag "${entry.tag}" does not start with "${prefix}_"`);
  }
  if (!(entry.when > prevWhen))
    errors.push(`journal tag "${entry.tag}" has a non-increasing "when"`);
  prevWhen = entry.when;
  tags.add(entry.tag);
  const file = `${entry.tag}.sql`;
  if (!sqlFiles.includes(file)) {
    errors.push(`journal references ${file}, which does not exist`);
  } else if (statSync(join(dir, file)).size === 0) {
    errors.push(`${file} is empty`);
  }
});

for (const file of sqlFiles) {
  if (!tags.has(file.replace(/\.sql$/, ""))) {
    errors.push(`${file} is not registered in meta/_journal.json`);
  }
}

if (errors.length) {
  console.error("Migration check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}
console.log(`Migration check passed: ${journal.entries.length} migrations, journal consistent.`);
