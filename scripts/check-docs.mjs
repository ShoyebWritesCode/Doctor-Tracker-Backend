import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const files = [
  "README.md",
  ...(await readdir("docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`),
];
let links = 0;
for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    assert(!target.startsWith("/"), `Use repository-relative documentation links: ${file}`);
    await access(resolve(dirname(file), decodeURIComponent(target)));
    links++;
  }
}
process.stdout.write(`Verified ${links} local links/images across ${files.length} documents.\n`);
