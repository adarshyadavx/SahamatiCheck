#!/usr/bin/env node
// Wording linter (CLAUDE.md rule 4). Scans every user-facing catalog for banned
// terms and exits non-zero on a hit. Also checks that en.json and hi.json have
// the same keys, so /hi never falls back silently.
//
// Scanned:
//   packages/i18n/{en,hi}.json
//   apps/*/locales/**/*.json
//   backend/core/**/templates*.{py,yaml,yml}   (if present)
//
// Usage: node packages/i18n/check-wording.mjs [--verbose]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const verbose = process.argv.includes("--verbose");

const banned = JSON.parse(readFileSync(join(here, "banned-words.json"), "utf8"));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// English: word boundaries, but treat "_" and letters as word chars so ids such
// as `fraud_prevention` (an ontology purpose id, not wording) do not match.
const enPatterns = banned.en.map((w) => ({
  word: w,
  re: new RegExp(`(?<![A-Za-z0-9_-])${escape(w).replace(/ /g, "[\\s-]+")}(?![A-Za-z0-9_])`, "i"),
}));
// Hindi: plain substring (Devanagari has no \b in JS regex).
const hiPatterns = banned.hi.map((w) => ({ word: w, re: new RegExp(escape(w)) }));
const allPatterns = [...enPatterns, ...hiPatterns];

const SKIP_DIRS = new Set(["node_modules", ".next", ".output", ".wxt", "dist", ".venv", "__pycache__", ".git"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Yield [path, string] for every string value in a JSON document. */
function* jsonStrings(node, path = "") {
  if (typeof node === "string") yield [path, node];
  else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* jsonStrings(node[i], `${path}[${i}]`);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$")) continue; // $comment etc.
      yield* jsonStrings(v, path ? `${path}.${k}` : k);
    }
  }
}

const hits = [];
let filesScanned = 0;

function checkText(file, where, text) {
  for (const { word, re } of allPatterns) {
    const m = re.exec(text);
    if (m) hits.push({ file: relative(root, file), where, word, excerpt: excerpt(text, m.index, m[0].length) });
  }
}

function excerpt(text, i, len) {
  const s = Math.max(0, i - 30);
  const e = Math.min(text.length, i + len + 30);
  return (s > 0 ? "…" : "") + text.slice(s, e).replace(/\s+/g, " ") + (e < text.length ? "…" : "");
}

function scanJson(file) {
  filesScanned++;
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    hits.push({ file: relative(root, file), where: "(parse)", word: "-", excerpt: `invalid JSON: ${err.message}` });
    return;
  }
  for (const [path, value] of jsonStrings(doc)) checkText(file, path, value);
}

function scanText(file) {
  filesScanned++;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => checkText(file, `line ${i + 1}`, line));
}

// 1. Shared catalogs.
const catalogs = ["en.json", "hi.json"].map((f) => join(here, f));
catalogs.forEach(scanJson);

// 2. App locale folders (apps/*/locales/**/*.json).
const appsDir = join(root, "apps");
if (existsSync(appsDir)) {
  for (const app of readdirSync(appsDir)) {
    const loc = join(appsDir, app, "locales");
    if (existsSync(loc)) walk(loc).filter((f) => f.endsWith(".json")).forEach(scanJson);
  }
}

// 3. Backend summary templates.
const backendCore = join(root, "backend", "core");
walk(backendCore)
  .filter((f) => /^templates.*\.(py|ya?ml)$/i.test(basename(f)))
  .forEach(scanText);

// 4. Key parity between en and hi.
function keys(node, prefix = "", out = new Set()) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) keys(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.add(prefix);
  return out;
}
const enKeys = keys(JSON.parse(readFileSync(catalogs[0], "utf8")));
const hiKeys = keys(JSON.parse(readFileSync(catalogs[1], "utf8")));
const missingHi = [...enKeys].filter((k) => !hiKeys.has(k));
const missingEn = [...hiKeys].filter((k) => !enKeys.has(k));

let failed = false;
if (hits.length) {
  failed = true;
  console.error(`✗ Banned wording found (${hits.length}):`);
  for (const h of hits) console.error(`  ${h.file} [${h.where}] "${h.word}": ${h.excerpt}`);
}
if (missingHi.length || missingEn.length) {
  failed = true;
  if (missingHi.length) console.error(`✗ Keys missing in hi.json: ${missingHi.join(", ")}`);
  if (missingEn.length) console.error(`✗ Keys missing in en.json: ${missingEn.join(", ")}`);
}

if (failed) process.exit(1);
console.log(
  `✓ Wording check passed: ${filesScanned} files, ${allPatterns.length} banned terms, ${enKeys.size} keys in parity.`,
);
if (verbose) console.log(`  root: ${root}`);
