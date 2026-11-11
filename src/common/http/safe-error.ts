const errorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AppError",
  "MongoServerError",
  "MongoNetworkError",
  "MongoServerSelectionError",
  "MongooseError",
  "ValidationError",
  "EnvironmentConfigError",
]);

/** Messages/causes can contain database URIs or submitted values. Keep code locations only. */
export function safeErrorDetails(error: unknown): { errorType: string; stackFrames: string[] } {
  if (!(error instanceof Error)) return { errorType: "UnknownError", stackFrames: [] };
  const stackFrames = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const location = line.match(
        /((?:file:\/\/)?\/[^()\n]+:\d+:\d+|node:[^()\n]+:\d+:\d+)\)?$/,
      )?.[1];
      if (!location) return [];
      const path = location.replace(/^file:\/\//, "");
      if (
        path.startsWith("node:internal/") ||
        path.startsWith(`${process.cwd()}/src/`) ||
        path.startsWith(`${process.cwd()}/node_modules/`) ||
        path.startsWith(`${process.cwd()}/dist/`)
      )
        return [path];
      return [];
    })
    .slice(0, 10);
  return { errorType: errorNames.has(error.name) ? error.name : "UnknownError", stackFrames };
}
