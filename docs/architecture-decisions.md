# Doctor Tracker - Phase 00 Architecture Decisions

Status: accepted for version 1

This document freezes decisions shared by the backend and frontend before scaffolding begins. Changes require an explicit update here, in `openapi.yaml`, and in the frontend contract notes.

## Runtime and repository policy

- Runtime: Node.js `22.17.1`, matching the available development environment.
- Package manager: npm `10.9.2`; each repository owns and commits its lockfile.
- Language: TypeScript with strict compiler checks in both applications.
- API: standalone Express service under `/api/v1`.
- Client: standalone Next.js App Router application.
- Database: MongoDB through Mongoose.
- Architecture: modular monolith; no queues, microservices, GraphQL, or event sourcing in version 1.

Patch-level runtime upgrades are allowed after CI and deployment verification. A major runtime or contract change requires a dedicated decision update.

## Deployment topology

The browser calls `/api/v1/...` on the frontend origin. Next.js rewrites that path to the standalone Express origin. The backend remains separately deployed, while the browser sees a same-origin API.

Benefits:

- The session cookie remains first-party.
- Production does not depend on cross-site cookies.
- Browser CORS complexity is minimized.
- The backend remains independently deployable and testable.

Local development follows the same browser path: Next.js on port 3000 proxies to Express on port 4000. Direct backend access remains available for integration tests and API tooling.

The backend uses an exact `FRONTEND_ORIGIN` allowlist and validates the `Origin` header for unsafe browser requests. It never reflects arbitrary credentialed origins. `trust proxy` will be configured for the selected deployment host during release work.

## Authentication decision

Version 1 uses first-party opaque sessions rather than JWTs or a third-party identity provider.

1. An administrator submits email and password.
2. The backend verifies the Argon2id password hash.
3. The backend generates at least 32 random bytes.
4. MongoDB stores only the SHA-256 hash of that token.
5. The original token is returned in `doctor_tracker_session` as an `HttpOnly` cookie.
6. Every protected API request resolves the session and active administrator.
7. Logout deletes the session before clearing the cookie.

Session policy:

- Absolute lifetime: 12 hours.
- Cookie path: `/api/v1`.
- `HttpOnly`: always.
- `Secure`: production only.
- `SameSite`: `Lax` for the same-origin proxy topology.
- Domain: omitted, producing a host-only cookie.
- Public registration, OAuth, password reset, MFA, and extra roles are out of scope.

Middleware in the Next.js application may use cookie presence as a fast redirect hint, but only the API authorizes access. The browser never stores tokens in localStorage or sessionStorage.

## CSRF and mutation policy

SameSite cookies are defense-in-depth, not the only check. For `POST`, `PATCH`, `PUT`, and `DELETE`, the API validates that `Origin` equals the configured frontend origin. Requests made by trusted non-browser test/operations tooling may use an explicitly documented test environment bypass; production browser mutations must carry the expected origin.

If deployment later requires `SameSite=None`, Phase 00 must be reopened and a synchronizer or signed double-submit CSRF token added before release.

## API conventions

- Base path: `/api/v1`.
- Media type: `application/json`; successful `204` responses have no body.
- Success envelope: `{ "data": ... }`, with optional pagination `meta`.
- Failure envelope: `{ "error": { "code", "message", "fieldErrors?", "requestId" } }`.
- IDs are lower-case 24-character MongoDB ObjectId strings exposed as `id`.
- Internal `_id`, `__v`, password hashes, normalized search fields, and session values are never serialized.
- Timestamps are ISO 8601 UTC date-times.
- `dateOfBirth` is an ISO calendar date (`YYYY-MM-DD`) to avoid time-zone drift.
- Unknown JSON fields are rejected.
- List defaults: `page=1`, `limit=20`; maximum limit is 100.
- Default list order: `createdAt:desc`, with `_id` as a hidden deterministic tiebreaker.
- `from` is inclusive and `to` is exclusive for date ranges.
- Validation failures are `400`, missing auth `401`, forbidden origin/access `403`, missing resources `404`, uniqueness/state conflicts `409`, rate limits `429`.

Stable version 1 error codes:

| Code | Typical status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body, path, query, date range, or content validation failed |
| `INVALID_CREDENTIALS` | 401 | Login credentials are invalid; account existence is not disclosed |
| `AUTHENTICATION_REQUIRED` | 401 | Session is missing, invalid, expired, revoked, or no longer active |
| `ORIGIN_NOT_ALLOWED` | 403 | Unsafe request origin failed the allowlist |
| `DOCTOR_NOT_FOUND` | 404 | Doctor ID does not resolve |
| `PATIENT_NOT_FOUND` | 404 | Patient ID does not resolve in the requested context |
| `ROUTE_NOT_FOUND` | 404 | API route does not exist |
| `DOCTOR_EMAIL_CONFLICT` | 409 | Normalized doctor email already exists |
| `RATE_LIMITED` | 429 | Request limit was exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected production-safe failure |
| `SERVICE_UNAVAILABLE` | 503 | Application is not ready to serve traffic |

## Search, filter, and sort behavior

Search is case-insensitive prefix matching over normalized values. User input is escaped and never treated as a regular expression or MongoDB operator.

Doctor search fields: name, email, and hospital.

Doctor filters:

- `specialization`: normalized exact match.
- `hospital`: normalized exact match.
- `createdFrom`: inclusive ISO date-time.
- `createdTo`: exclusive ISO date-time.
- Sort: `createdAt:desc`, `createdAt:asc`, `name:asc`, `name:desc`.

Patient search fields: name, email, and phone.

Patient filters:

- `doctorId`: exact ObjectId.
- `condition`: normalized exact match.
- `status`: `active`, `follow_up`, or `discharged`.
- `createdFrom`: inclusive ISO date-time.
- `createdTo`: exclusive ISO date-time.
- Sort: `createdAt:desc`, `createdAt:asc`, `name:asc`, `name:desc`, `lastVisitAt:desc`, `lastVisitAt:asc`.

Page-based pagination is selected because the assignment explicitly expects conventional pagination and the demo dataset is bounded. Cursor pagination is the documented scale path for deep collections.

## Domain contract

### Administrator

- `id`, `name`, normalized unique `email`, `status`, `lastLoginAt`, and timestamps.
- Only the explicit seed/bootstrap script creates an administrator in version 1.

### Doctor

- Required: `name`, `specialization`, `hospital`, `phone`, `email`.
- Email is normalized and unique.
- `patientCount` is returned on list/detail responses and starts at zero.
- Doctor update/delete are intentionally outside the supplied version 1 requirements.

### Patient

- Required: `doctorId`, `name`, `condition`, and `status`.
- At least one of `email` or `phone` is required.
- Optional: `dateOfBirth`, `gender`, `lastVisitAt`, and short `notes`.
- Gender values: `female`, `male`, `non_binary`, `prefer_not_to_say`.
- Patient status values: `active`, `follow_up`, `discharged`.
- The doctor association is immutable through the patient patch endpoint.
- Deletion is permanent in version 1 and requires explicit UI confirmation.

All data used for development, tests, screenshots, and demos is fictional. This application is not represented as a compliant clinical records system.

## Patient count consistency

`Doctor.patientCount` is denormalized for efficient doctor lists and dashboard ranking. Patient creation/deletion and count increment/decrement happen in one MongoDB transaction. MongoDB must therefore run in a transaction-capable replica-set topology, including local development.

If transactions cannot be supported on the chosen host, the design must change to aggregation-derived counts before implementation; silent eventual drift is not accepted.

## Dashboard contract

`GET /api/v1/dashboard/summary` accepts:

- `from`: required `YYYY-MM-DD`, inclusive.
- `to`: required `YYYY-MM-DD`, exclusive.
- `timezone`: optional IANA name, default `Asia/Dhaka`.
- Maximum requested interval: 366 days.

It returns:

- Total doctors.
- Total patients.
- Patients created within the range.
- Average patients per doctor.
- A continuous, zero-filled daily patient series.
- Up to ten doctors ranked by patient count.

Average patients per doctor is `0` when there are no doctors and otherwise rounded to two decimal places. Ranking ties use doctor name then ID for deterministic output.

## Index hypotheses

These are validated with `explain('executionStats')` against representative seed data before release.

Administrators and sessions:

- Unique admin email.
- Unique session token hash.
- Session expiry TTL.
- Session administrator reference.

Doctors:

- Unique email.
- Creation date plus ID.
- Specialization plus creation date plus ID.
- Hospital plus creation date plus ID.
- Normalized search fields as justified by the final prefix-query implementation.

Patients:

- Doctor plus creation date plus ID.
- Condition plus creation date plus ID.
- Status plus creation date plus ID.
- Normalized search fields as justified by the final prefix-query implementation.

Indexes are hypotheses, not decoration. Redundant or unused indexes will be removed after query-plan review.

## Operational decisions

- `/health` reports process liveness without touching MongoDB.
- `/ready` confirms database readiness without exposing internals.
- Every request receives/returns `X-Request-Id`.
- Logs contain route template, method, status, duration, request ID, and administrator ID when present.
- Passwords, cookies, tokens, authorization headers, patient bodies/notes, and raw patient searches are redacted.
- OpenAPI JSON is served at `/api-docs/openapi.json`.
- Seed execution is explicit and idempotent; application startup never seeds or drops data.

## Deferred decisions

- Final hosting vendors and production URLs.
- Final MongoDB Atlas project/cluster details.
- Error-monitoring vendor, if any.
- A custom domain.

These do not block Phases 01-07. They require human account access during Phase 08, and the user must be notified before that work begins.
