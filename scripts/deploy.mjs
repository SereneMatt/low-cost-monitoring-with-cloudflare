import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const secretNames = ["SLACK_WEBHOOK_URL", "RATE_LIMIT_SALT"];
const lines = [];
for (const name of secretNames) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name} in .env`);
    process.exit(1);
  }
  lines.push(`${name}=${value}`);
}

const directory = mkdtempSync(join(tmpdir(), "form-monitor-secrets-"));
const secretsFile = join(directory, "secrets.env");
writeFileSync(secretsFile, `${lines.join("\n")}\n`);

const result = spawnSync("cf", ["deploy", "--secrets-file", secretsFile, ...process.argv.slice(2)], {
  stdio: "inherit",
});
rmSync(directory, { recursive: true, force: true });
process.exit(result.status ?? 1);
