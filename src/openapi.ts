import { readFileSync } from "node:fs";
import { parse } from "yaml";

// One checked-in source, resolved equally from src/ and compiled dist/.
// No remote references, environment values or database data enter this document.
export const openApiDocument: unknown = parse(
  readFileSync(new URL("../docs/openapi.yaml", import.meta.url), "utf8"),
);
