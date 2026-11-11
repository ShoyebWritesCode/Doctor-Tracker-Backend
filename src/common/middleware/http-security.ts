import type { RequestHandler } from "express";
import {
  contentSecurityPolicy,
  crossOriginOpenerPolicy,
  crossOriginResourcePolicy,
  originAgentCluster,
  referrerPolicy,
  strictTransportSecurity,
  xContentTypeOptions,
  xDnsPrefetchControl,
  xDownloadOptions,
  xFrameOptions,
  xPermittedCrossDomainPolicies,
  xXssProtection,
} from "helmet";
import { AppError } from "../errors/app-error.js";

/** Named exports work in both native Node ESM and Vercel's TypeScript loader. */
export function securityHeaders(secureTransport: boolean): RequestHandler[] {
  return [
    contentSecurityPolicy({
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": secureTransport ? [] : null,
      },
    }),
    crossOriginOpenerPolicy(),
    crossOriginResourcePolicy(),
    originAgentCluster(),
    referrerPolicy(),
    xContentTypeOptions(),
    xDnsPrefetchControl(),
    xDownloadOptions(),
    xFrameOptions(),
    xPermittedCrossDomainPolicies(),
    xXssProtection(),
    ...(secureTransport ? [strictTransportSecurity({ maxAge: 31_536_000 })] : []),
  ];
}

export const requireJsonBody: RequestHandler = (request, _response, next) => {
  const hasBody =
    Number(request.get("Content-Length") ?? 0) > 0 ||
    request.get("Transfer-Encoding") !== undefined;
  if (hasBody && !request.is("application/json")) {
    next(
      new AppError({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Request bodies must use application/json.",
        statusCode: 415,
      }),
    );
    return;
  }
  next();
};

/** The browser uses a same-origin proxy; direct CORS is limited to one exact origin. */
export function exactOriginCors(frontendOrigin: string): RequestHandler {
  const methods = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE"]);
  const headers = new Set(["content-type", "x-request-id"]);
  return (request, response, next) => {
    response.vary("Origin");
    const origin = request.get("Origin");
    if (!origin) {
      next();
      return;
    }
    if (origin !== frontendOrigin) {
      next(
        new AppError({
          code: "ORIGIN_NOT_ALLOWED",
          message: "The request origin is not allowed.",
          statusCode: 403,
        }),
      );
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", frontendOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader(
      "Access-Control-Expose-Headers",
      "X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset",
    );
    if (request.method !== "OPTIONS") {
      next();
      return;
    }
    response.vary("Access-Control-Request-Method");
    response.vary("Access-Control-Request-Headers");
    const requestedMethod = request.get("Access-Control-Request-Method");
    const requestedHeaders = (request.get("Access-Control-Request-Headers") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (
      !requestedMethod ||
      !methods.has(requestedMethod) ||
      requestedHeaders.some((value) => !headers.has(value))
    ) {
      next(
        new AppError({
          code: "CORS_PREFLIGHT_REJECTED",
          message: "The preflight request is not allowed.",
          statusCode: 403,
        }),
      );
      return;
    }
    response.setHeader("Access-Control-Allow-Methods", Array.from(methods).join(", "));
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Request-Id");
    response.setHeader("Access-Control-Max-Age", "600");
    response.status(204).end();
  };
}
