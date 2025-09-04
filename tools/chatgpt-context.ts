// tools/chatgpt-context.ts
// Usage: pnpm exec tsx tools/chatgpt-context.ts
// Output: .chatgpt/chatgpt-context.md
//
// What this does:
// - Walks the repo and snapshots "almost everything" that matters.
// - Excludes secret-y files (.env*), build artifacts, caches, and giant/binary files.
// - Trims each included file to MAX_BYTES (default 60 KB) to keep the snapshot readable.
// - Adds repo metadata: branch, commit, diff stat, recent commits, versions.
//
// Tweakables (search "CONFIG"):
// - IGNORE_DIRS, IGNORE_FILES, ALLOW_EXTS, MAX_FILES, MAX_BYTES_PER_FILE
//
// Notes:
// - No env secrets are read; .env* is excluded by default.
// - If you need a file included even if it's excluded by name/size, add it to EXTRA_INCLUDES.

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve, extname } from "node:path";

type RepoInfo = {
  branch: string;
  commit: string;
  node: string;
  pnpm: string;
  next: string;
  react: string;
  lastCommits: string;
  uncommitted: string;
  diffStat: string;
  treeSample: string;
};

type PickedFile = { path: string; bytes: number };

const ROOT = resolve(process.cwd());
const OUT_DIR = join(ROOT, ".chatgpt");
const OUT_FILE = join(OUT_DIR, "chatgpt-context.md");

// -------------------- CONFIG --------------------
const MAX_FILES = 2000; // overall safety cap
const MAX_BYTES_PER_FILE = 60_000; // 60 KB per file
const MAX_TREE_SAMPLE = 600; // how many paths to print in the tree sample

// Directories to skip at walk time
const IGNORE_DIRS = new Set<string>([
  ".git",
  "node_modules",
  ".next",
  ".vercel",
  ".turbo",
  ".vscode",
  ".idea",
  ".pnpm-store",
  "dist",
  "build",
  "coverage",
  "cypress",
  ".cache",
  ".output",
  ".firebase",
  "functions/node_modules",
]);

// Files (exact filename) to always skip
const IGNORE_FILES = new Set<string>([
  // env/secrets
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  "firebase-debug.log",
  // big lockfiles or OS trash
  "package-lock.json",
  "yarn.lock",
  "Thumbs.db",
  ".DS_Store",
]);

// Extensions we consider "text/code" enough to snapshot.
// Other extensions will be included only if small & not binary.
const ALLOW_EXTS = new Set<string>([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".svg",
  ".txt",
  ".rules", // firestore.rules
  ".map",   // small sourcemaps (trimmed)
]);

// Additional RELATIVE paths to force-include even if they would be ignored.
// e.g. "firebase.json", "firestore.rules"
const EXTRA_INCLUDES = new Set<string>([
  "package.json",
  "pnpm-lock.yaml",
  "next.config.mjs",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "firebase.json",
  "firestore.rules",
  "public/manifest.json",
  "public/firebase-messaging-sw.js",
]);

// Files regarded as "binary" by extension (skip unless very tiny)
const BINARY_EXTS = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".gif",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".zip",
  ".7z",
  ".tar",
  ".gz",
]);
// ------------------------------------------------

// Helpers
function sh(cmd: string, { trim = true } = {}) {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
    return trim ? out.trim() : out;
  } catch {
    return "";
  }
}

function isLikelyBinary(path: string, sample?: Buffer) {
  const ext = extname(path).toLowerCase();
  if (BINARY_EXTS.has(ext)) return true;
  if (!sample) return false;
  // Heuristic: contains a 0x00 byte?
  for (let i = 0; i < sample.length && i < 1024; i++) {
    if (sample[i] === 0x00) return true;
  }
  return false;
}

function shouldIgnoreFile(relPath: string, name: string) {
  if (IGNORE_FILES.has(name)) return true;
  // don’t ever include .env* or service account keys
  if (name.startsWith(".env")) return true;
  if (/service.*account.*\.json$/i.test(name)) return true;
  if (/google.*credentials.*\.json$/i.test(name)) return true;
  return false;
}

function shouldIncludeByExt(relPath: string) {
  const ext = extname(relPath).toLowerCase();
  return ALLOW_EXTS.has(ext);
}

function safeRead(relPath: string, maxBytes = MAX_BYTES_PER_FILE) {
  try {
    const abs = join(ROOT, relPath);
    const buf = readFileSync(abs);
    const head = buf.subarray(0, maxBytes);
    const binary = isLikelyBinary(relPath, head);
    if (binary) {
      if (buf.length <= 4_096) {
        // Tiny binary: embed a note
        return `<!-- binary file ${relPath} (${buf.length} bytes) omitted -->`;
      }
      return `<!-- binary file ${relPath} (${buf.length} bytes) omitted -->`;
    }
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return `${head.toString("utf8")}\n\n<!-- TRUNCATED (${buf.length - maxBytes} bytes omitted) -->`;
  } catch {
    return `<!-- missing: ${relPath} -->`;
  }
}

function codeFenceLang(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".ts" || ext === ".tsx") return "ts";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "ts";
  if (ext === ".json") return "json";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".css" || ext === ".scss" || ext === ".less") return "css";
  if (ext === ".html") return "html";
  if (ext === ".md") return "md";
  if (ext === ".svg") return "xml";
  if (ext === ".rules") return ""; // plain fence
  return "";
}

function* walk(dir: string, baseRel = ""): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;
    const rel = baseRel ? `${baseRel}/${name}` : name;

    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue;
      yield* walk(join(dir, name), rel);
      continue;
    }

    // file
    yield rel;
  }
}

function collectFiles(): PickedFile[] {
  const picks: PickedFile[] = [];
  for (const rel of walk(ROOT)) {
    if (picks.length >= MAX_FILES) break;

    const name = rel.split("/").pop() || rel;
    // Ignore obvious junk / secrets
    if (shouldIgnoreFile(rel, name)) continue;

    // Always allow extra includes (even if large; will be trimmed)
    const forceInclude = EXTRA_INCLUDES.has(rel);

    // Skip huge files early
    let size = 0;
    try {
      size = statSync(join(ROOT, rel)).size;
    } catch {
      continue;
    }

    // Heuristic rules:
    const allowedExt = shouldIncludeByExt(rel);
    const tiny = size <= 4_096;

    if (forceInclude || allowedExt || tiny) {
      picks.push({ path: rel, bytes: size });
      continue;
    }

    // Allow other text-like files up to 200 KB (trimmed later)
    const ext = extname(rel).toLowerCase();
    if (!BINARY_EXTS.has(ext) && size <= 200_000) {
      picks.push({ path: rel, bytes: size });
      continue;
    }
    // otherwise skip
  }
  return picks;
}

function gatherRepoInfo(): RepoInfo {
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const commit = sh("git rev-parse --short HEAD");
  const node = sh("node -v");
  const pnpm = sh("pnpm -v");
  const lastCommits = sh("git log -n 20 --oneline");
  const uncommitted = sh("git status -s --untracked-files=yes");
  const diffStat = sh(
    "git diff --stat --no-color origin/main... || git diff --stat --no-color || true",
    { trim: false }
  );

  let next = "";
  let react = "";
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    next = pkg?.dependencies?.next || pkg?.devDependencies?.next || "";
    react = pkg?.dependencies?.react || pkg?.devDependencies?.react || "";
  } catch {}

  const treeSample = sh(
    `git ls-tree -r --name-only HEAD | sed -n '1,${MAX_TREE_SAMPLE}p'`
  );

  return {
    branch,
    commit,
    node,
    pnpm,
    next,
    react,
    lastCommits,
    uncommitted,
    diffStat,
    treeSample,
  };
}

function main() {
  const info = gatherRepoInfo();
  const files = collectFiles();

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const now = new Date().toISOString();
  let md = `
# Abot Ko Na — ChatGPT Context Snapshot (auto)

- Branch: \`${info.branch}\` @ \`${info.commit}\`
- Generated: ${now}
- Node: \`${info.node}\`, pnpm: \`${info.pnpm}\`
- Next: \`${info.next}\`, React: \`${info.react}\`

## Recent Commits (20)
\`\`\`
${info.lastCommits || "(none)"}
\`\`\`

## Uncommitted Changes
\`\`\`
${info.uncommitted || "(clean)"}
\`\`\`

## Diff Stat vs origin/main (fallback: working tree)
\`\`\`
${info.diffStat || "(none)"}
\`\`\`

## Project Tree (first ${MAX_TREE_SAMPLE} files)
\`\`\`
${info.treeSample || "(unavailable)"}
\`\`\`

--- 

## Included Files (${files.length} of max ${MAX_FILES})
`.trim();

  for (const f of files) {
    const content = safeRead(f.path, MAX_BYTES_PER_FILE).replace(/```/g, "ˋˋˋ");
    const lang = codeFenceLang(f.path);
    md += `

### ${f.path}  _(size: ${f.bytes}B)_
\`\`\`${lang}
${content}
\`\`\`
`;
  }

  writeFileSync(OUT_FILE, md, "utf8");
  console.log(`Wrote ${OUT_FILE} with ${files.length} files.`);
}

main();
