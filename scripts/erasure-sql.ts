/**
 * Prints SQL for the manual erasure process (docs/data-erasure-runbook.md).
 * It never connects to a database.
 *   npm run erasure:sql -- GH-C0001 --by owner@example.com > erase.sql
 *   npm run erasure:sql -- --review
 */
import { erasureStatements, retentionReviewSql } from "../lib/crm/erasure";

const args = process.argv.slice(2);

if (args.includes("--review")) {
  console.log(retentionReviewSql());
} else {
  const code = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--by") ?? "";
  const by = args[args.indexOf("--by") + 1] ?? "";
  try {
    const statements = erasureStatements(code.toUpperCase(), args.includes("--by") ? by : "", new Date().toISOString());
    console.log(statements.map((sql) => `${sql};`).join("\n\n"));
  } catch (error) {
    console.error((error as Error).message);
    console.error("Usage: npm run erasure:sql -- GH-C0001 --by owner@example.com");
    process.exit(1);
  }
}
