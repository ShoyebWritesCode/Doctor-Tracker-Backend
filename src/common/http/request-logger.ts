import type { Request, RequestHandler } from "express";
import type { Logger } from "pino";
import { createRequestId } from "./request-id.js";

function routeTemplate(request: Request): string {
  const route: unknown = request.route;
  if (!(
    typeof route === "object" &&
    route !== null &&
    "path" in route &&
    typeof route.path === "string"
  ))
    return "unmatched";
  // Never concatenate raw baseUrl: scoped router mounts contain user-supplied IDs.
  const pathname = request.originalUrl.split("?", 1)[0] ?? "";
  const mounted = /^\/api\/v1\/doctors\/[^/]+\/patients(?:\/|$)/.test(pathname)
    ? "/api/v1/doctors/:doctorId/patients"
    : (["/api/v1/auth", "/api/v1/doctors", "/api/v1/patients", "/api/v1/dashboard"].find(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      ) ?? "");
  if (mounted === "/api/v1/doctors/:doctorId/patients")
    return `${mounted}${route.path === "/" ? "" : route.path}`;
  if (
    ["/api/v1/auth", "/api/v1/doctors", "/api/v1/patients", "/api/v1/dashboard"].includes(mounted)
  )
    return `${mounted}${route.path === "/" ? "" : route.path}`;
  return mounted ? "matched" : route.path;
}

export function requestLogger(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const requestId = createRequestId(request, response);
    request.id = requestId;
    request.log = logger.child({ requestId, method: request.method });
    response.log = request.log;
    const started = performance.now();
    let recorded = false;
    function complete(aborted: boolean) {
      if (recorded) return;
      recorded = true;
      request.log.info(
        {
          route: routeTemplate(request),
          statusCode: aborted ? 499 : response.statusCode,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
          ...(request.auth ? { adminId: request.auth.admin.id } : {}),
        },
        aborted ? "Request aborted" : "Request completed",
      );
    }
    response.once("finish", () => complete(false));
    response.once("close", () => complete(!response.writableFinished));
    next();
  };
}
