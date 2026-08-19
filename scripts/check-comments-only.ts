/** Proves a diff changed only comments: strips comments from both sides and compares code. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const base = process.argv[2] ?? "HEAD";

const SOURCE_FILE_RE = /\.(?:ts|tsx|mjs|js)$/u;

const strip = (text: string, file: string) =>
  ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: false,
    compilerOptions: {
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      isolatedModules: true,
    },
  }).outputText;

const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=M", base], {
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => SOURCE_FILE_RE.test(f));

const offenders: string[] = [];
for (const file of changed) {
  let before: string;
  try {
    before = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
  } catch {
    continue;
  }
  const after = readFileSync(file, "utf8");
  if (strip(before, file) !== strip(after, file)) offenders.push(file);
}

if (offenders.length) {
  console.error("Code changed (not just comments) in:");
  for (const f of offenders) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`comments-only: OK (${changed.length} file(s) checked against ${base})`);
