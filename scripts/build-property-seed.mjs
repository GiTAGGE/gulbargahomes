import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

const root = process.cwd();
const contentDir = path.join(root, "content", "properties");
const outFile = path.join(root, "lib", "property-seed.json");

const files = fs
  .readdirSync(contentDir)
  .filter((file) => file.endsWith(".mdx"))
  .sort();

const records = files.map((file) => {
  const filePath = path.join(contentDir, file);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  const slug = file.replace(/\.mdx$/i, "");
  return {
    slug,
    mtime: fs.statSync(filePath).mtime.toISOString(),
    body: content.trim(),
    data: { ...data, slug },
  };
});

fs.writeFileSync(outFile, `${JSON.stringify(records)}\n`);
console.log(`Wrote ${records.length} properties to lib/property-seed.json`);
