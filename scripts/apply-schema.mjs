import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseId = process.env.D1_DATABASE_ID;
if (!databaseId) {
  console.error("Set D1_DATABASE_ID in .env");
  process.exit(1);
}

const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const args = ["d1", "raw", databaseId, "--sql", sql];
if (process.argv.includes("--local")) args.push("--local");

const result = spawnSync("cf", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
