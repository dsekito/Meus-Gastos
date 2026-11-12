// Test runner without dependencies.
//   --check  syntax check of js/*.js and sw.js
//   --unit   test/*.test.js and test/*.test.cjs
//   --e2e    test/*.e2e.cjs (needs Playwright, Edge and `npm start` on port 8000)
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const list = (dir, pattern) => fs.readdirSync(path.join(root, dir))
  .filter(name => pattern.test(name)).sort().map(name => path.join(dir, name));

const jobs = [];
if (args.has("--check")) {
  [...list("js", /\.js$/), "sw.js"].forEach(file => jobs.push(["--check", file]));
}
if (args.has("--unit")) list("test", /\.test\.c?js$/).forEach(file => jobs.push([file]));
if (args.has("--e2e")) list("test", /\.e2e\.cjs$/).forEach(file => jobs.push([file]));
if (!jobs.length) {
  console.error("Use --check, --unit e/ou --e2e.");
  process.exit(2);
}

const failures = [];
for (const job of jobs) {
  const label = job.join(" ");
  const result = spawnSync(process.execPath, job, { cwd: root, encoding: "utf8", timeout: 300000 });
  const ok = result.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) {
    failures.push(label);
    process.stdout.write(`${result.stdout || ""}${result.stderr || ""}`.split("\n").slice(-25).join("\n"));
    if (result.error) console.log(result.error.message);
  }
}
console.log(`\n${jobs.length - failures.length}/${jobs.length} aprovados.`);
if (failures.length) process.exit(1);
