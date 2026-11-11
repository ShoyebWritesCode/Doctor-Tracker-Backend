const safeCookieName = /^[A-Za-z0-9_-]+$/;

type SessionCookieOptions = {
  expires: Date;
  name: string;
  secure: boolean;
  token: string;
};

function assertCookieName(name: string): void {
  if (!safeCookieName.test(name)) throw new Error("Invalid session cookie name.");
}

export function serializeSessionCookie(options: SessionCookieOptions): string {
  assertCookieName(options.name);
  return [
    `${options.name}=${encodeURIComponent(options.token)}`,
    "Path=/api/v1",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${options.expires.toUTCString()}`,
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

export function serializeClearedSessionCookie(name: string, secure: boolean): string {
  return serializeSessionCookie({ expires: new Date(0), name, secure, token: "" });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
