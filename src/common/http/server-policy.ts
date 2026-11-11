import { createServer, type RequestListener, type Server } from "node:http";

/** Applies to the standalone listener only; Vercel owns its network/lifecycle limits. */
export function createHttpServer(listener: RequestListener): Server {
  const server = createServer({ maxHeaderSize: 16 * 1024 }, listener);
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 1000;
  server.setTimeout(30_000, (socket) => socket.destroy());
  return server;
}

export function closeHttpServer(server: Server, deadlineMs = 9000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      reject(new Error("HTTP drain deadline exceeded"));
    }, deadlineMs);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}
