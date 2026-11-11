import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const trustedRequestId = /^[A-Za-z0-9._-]{1,128}$/;

export function createRequestId(request: IncomingMessage, response: ServerResponse): string {
  const provided = request.headers["x-request-id"];
  const requestId =
    typeof provided === "string" && trustedRequestId.test(provided) ? provided : randomUUID();

  response.setHeader("X-Request-Id", requestId);
  return requestId;
}
