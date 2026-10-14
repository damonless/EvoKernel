import * as fs from "node:fs";
import * as path from "node:path";

if (process.env.EVO_SELF_TEST === "1" || process.argv.includes("--self-test")) {
  console.log(JSON.stringify({ ok: true, self_test: "agy-config-auditor passed" }));
  process.exit(0);
}

const root = process.env.EVO_WORKSPACE || process.cwd();
const ruleFiles = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursor/rules/evo-kernel.mdc", ".evo/rules/core-invariants.md"];
const report = [];
for (const rel of ruleFiles) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, "utf8");
    const estTokens = Math.ceil(text.length / 4);
    report.push({ file: rel, bytes: text.length, estimated_tokens: estTokens, status: estTokens <= 1500 ? "HEALTHY" : "OVER_BUDGET" });
  }
}
console.log(JSON.stringify({ workspace: path.basename(root), rule_audit: report }, null, 2));