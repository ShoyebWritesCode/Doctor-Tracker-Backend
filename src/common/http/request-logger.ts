import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { createRequestId } from "./request-id.js";

function pathnameOnly(url: string | undefined): string {
  if (!url) {
    return "/";
  }

  return url.split("?", 1)[0] ?? "/";
}

export function requestLogger(logger: Logger) {
  return pinoHttp({
    customAttributeKeys: {
      responseTime: "durationMs",
    },
    genReqId: createRequestId,
    logger,
    serializers: {
      req(request: IncomingMessage) {
        return {
          id: request.id,
          method: request.method,
          path: pathnameOnly(request.url),
        };
      },
      res(response: ServerResponse) {
        return {
          statusCode: response.statusCode,
        };
      },
    },
  });
}
