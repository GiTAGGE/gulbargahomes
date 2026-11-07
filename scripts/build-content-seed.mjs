import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

const root = process.cwd();

function writeSeed(contentDir, outFile) {
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
      body: content.trim(),
      data: { ...data, slug: data.slug ?? slug },
    };
  });

  fs.writeFileSync(outFile, `${JSON.stringify(records)}\n`);
  console.log(`Wrote ${records.length} records to ${path.relative(root, outFile)}`);
}

writeSeed(path.join(root, "content", "projects"), path.join(root, "lib", "project-seed.json"));
writeSeed(path.join(root, "content", "designs"), path.join(root, "lib", "design-seed.json"));
