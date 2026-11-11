# Security and operations

This is a single-administrator demonstration using fictional records, not a certified clinical records system. Security controls reduce risk; they do not establish medical/privacy compliance or replace managed edge protection.

## HTTP boundary

- Helmet sets security headers on success and error responses; Express version disclosure is disabled. The JSON API's CSP denies content loading and framing. HSTS is enabled only with secure transport; local HTTP development does not receive HSTS.
- All responses are `private, no-store`, including unknown routes and early errors. Public health responses contain only `ok`/`ready`; dependency failures reveal no credentials, versions, or database addresses.
- Bodies must be JSON when present, have a 100 KiB limit, and cannot be compressed. Bodyless logout and DELETE requests remain supported. Unsupported media/encoding returns 415; malformed JSON returns 400; oversized bodies return 413, always in the normal request-ID envelope.
- Express uses its simple query parser. Strict Zod DTOs reject unknown fields, nested Mongo operators, prototype keys and unsupported query shapes. Persistence filters are constructed from validated fields rather than spreading input.

## Origin, sessions and proxy trust

The frontend uses a same-origin `/api/v1` proxy. Direct CORS permits exactly `FRONTEND_ORIGIN`, credentials, and the declared methods/headers. Other origins, including `null`, receive 403 without CORS permission. Preflights do not connect to MongoDB or consume counters.

Mutations require the exact Origin header. Referer is deliberately **not** a fallback. The existing missing-Origin bypass exists only in `NODE_ENV=test`, never development/production. CORS is not authentication; all data routes still require a live database-backed administrator session.

Cookies remain opaque, revocable, HttpOnly, SameSite=Lax, host-only, absolute-expiry cookies scoped to `/api/v1`; Secure is mandatory in production. No browser JWT/local-storage credentials are used. Unknown accounts, disabled accounts and incorrect passwords receive generic sign-in failures.

`TRUST_PROXY_HOPS=0` trusts no forwarded client headers locally. Production currently uses `1` behind Vercel's managed ingress. Do not increase it merely to make a forwarded IP look plausible. Re-verify after changing the hosting/proxy topology; forwarded headers from an unmanaged route must not become authoritative.

## Shared request limits

`API_RATE_LIMIT` defaults to 600 requests per client IP per fixed 60-second window, across all `/api/v1` routes, including unauthenticated/unknown API routes. Health/readiness and accepted preflights are excluded. Limit responses are 429 with `Retry-After` and `RateLimit-*` headers. Login retains additional independent IP/account limits over 15 minutes; its headers describe the login limit.

Counters use MongoDB atomic increments shared across function instances. Only SHA-256 digests of namespaced IP/window keys are persisted, not raw IPs. `request_limits` expires through `request_limit_expiry_ttl`; existing login counters retain their separate TTL index. TTL cleanup is asynchronous; window identity enforces reset independently of deletion. Fixed windows permit a boundary burst; shared NATs share a budget. This is application throttling, not volumetric DDoS protection.

Create the `request_limit_expiry_ttl` index before releasing this version: production disables automatic index creation. Use `RequestLimitModel.createIndexes()` from a trusted operator process; do not use `syncIndexes()` against production, since it can remove unrelated indexes. A counter-store failure returns safe 503, never unthrottled access. Readiness probes remain independent of throttling.

The API does not retry business requests. A unique-counter first-insert race retries only the rejected counter increment, never the downstream action. MongoDB driver's retryable writes and transaction retries retain their database-level consistency semantics; they do not authorize blindly resubmitting POST/PATCH/DELETE HTTP calls. The frontend's mutations do not opt into automatic retries.

## Privacy-safe diagnostics

Completed/aborted request logs contain method, **route template**, response status, duration, request ID, and administrator ID when authenticated. Unmatched URLs are logged as `unmatched`, not the supplied path. Raw paths/IDs, query values, patient bodies, cookies, authorization headers, account email and session IDs are not logged.

Unexpected errors generate one error record correlated by request ID. Instead of serializing driver messages/causes (which can embed patient values or URIs), logs retain a bounded error classification and up to ten source-location stack frames. Original exception messages and arbitrary stack text are intentionally discarded, including fatal/startup/seed errors. Production 500 responses never expose internal AppError details. Defensive structured-field redaction supplements this allowlisted logging policy; it is not permission to log arbitrary objects or interpolate input into messages.

Production logs are JSON; development uses the readable Pino transport. No external monitoring provider is enabled. Before adding one, disable body/query/header/session capture and session replay, scrub exception messages and breadcrumbs, configure retention/access, and test redaction against synthetic secrets before transmitting events. Never attach real health information.

Slow Mongo operation visibility defaults to a 250 ms threshold in `NODE_ENV=development` and is disabled otherwise. A controlled staging diagnostic can explicitly pass `slowQueryMs: 250` to `connectMongo`; pass `0` to disable. Instrumentation only logs allowlisted operation name, duration and outcome, not command documents, results, namespaces, connection addresses or failure messages. Listener cleanup prevents duplicate events after reconnects.

## Listener and process lifecycle

Standalone Node HTTP uses 16 KiB maximum headers, at most 64 headers, 10-second header receipt, 30-second request receipt/inactivity, 5-second keep-alive, and 1,000 requests per socket. An inactive socket is destroyed. These are listener/network limits, not a guarantee that all database work is cancellable.

SIGINT/SIGTERM stop accepting requests, close idle connections, allow in-flight HTTP work up to nine seconds, then disconnect MongoDB. A ten-second overall deadline force-closes connections and exits nonzero. Uncaught exceptions/rejections are sanitized, logged, and terminate the process so a supervisor can restart it. Continuing after a fatal error is not supported. After `headersSent`, errors receive one sanitized log record and the partial response is closed without another JSON response. Raw exceptions are not forwarded to Express's default handler, which can print exception messages to stderr.

Vercel owns its listener, invocation timeout, restarts and termination: the standalone socket/process settings do **not** pretend to configure Vercel. The serverless entry instead reuses a bounded Mongo pool and shared counters. Atlas's broad network allowlist is an explicitly approved free-tier deployment compromise, not network isolation; credentials/TLS and database-scoped privileges remain required. Managed backups/static egress are not claimed or silently purchased.

## Verification

`tests/integration/security.test.ts` covers headers, exact CORS, media/body bounds, production Origin policy, shared/concurrent limits, proxy trust, counter outages and captured-log privacy. `tests/unit/http-policy.test.ts` covers listener bounds, actual oversized headers, in-flight draining, forced shutdown, strict input and `headersSent`. `tests/unit/slow-queries.test.ts` verifies diagnostic payload exclusion and listener cleanup. Existing auth/patient tests cover cookie/session failures, login limits, transactional writes and failure non-disclosure.

Run lint, typecheck, the full isolated integration suite, production compilation and compiled-runtime import checks before release. Dependency audit results are time-specific, not a guarantee of ongoing safety. Never run concurrency/limit tests against the shared production demo account or clean live collections for testing.

### Primary references

- [Helmet configuration](https://github.com/helmetjs/helmet)
- [Node HTTP server lifecycle and timeout semantics](https://nodejs.org/api/http.html)
- [MongoDB command monitoring](https://www.mongodb.com/docs/drivers/node/current/monitoring-and-logging/monitoring/)
