# Doctor Tracker API

The standalone REST API for Doctor Tracker, an authenticated administrative application for managing doctors, their patients, and operational analytics. The service is built with Express, strict TypeScript, MongoDB, and revocable opaque sessions.

## Prerequisites

- Node.js `22.17.1`
- npm `10.9.2`
- A MongoDB replica set (Atlas or a locally configured replica set) for transactional patient writes

## Local setup

```bash
cp .env.example .env
npm ci
npm run seed:admin
npm run dev
```

The API listens on `http://localhost:4000` by default. Check process liveness at `GET /health` and MongoDB readiness at `GET /ready`. The seed command is explicit and idempotent; application startup never creates accounts.

## Fictional demo data

After configuring the database, run `npm run seed:demo` to preview the missing demo records, then `npm run seed:demo -- --apply` to insert them explicitly. The dataset contains 24 doctors across 12 specialties and 256 patients, with varied statuses, conditions, contact completeness, birth dates, visits, and creation dates over roughly 90 days. Doctor counts include both seeded and manually added patients.

All records are synthetic. Patient notes identify them as fictional, emails use reserved `.example.test` domains, and phone numbers use reserved `555-01xx` placeholders. No real patient information or clinical guidance is included.

The seeder uses stable IDs and one transaction. It adds missing demo records only, preserves existing records and administrator edits, and rolls back on conflicts. Re-running it does not duplicate records or inflate doctor counts. Deliberately deleted demo records are considered missing and will be restored if the command is run again. It does not reset the database, reseed administrator credentials, or run on application startup or deployment.

## Commands

| Command                    | Purpose                                  |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Run the API in watch mode                |
| `npm run build`            | Compile production JavaScript to `dist/` |
| `npm start`                | Run the compiled server                  |
| `npm run seed:admin`       | Create or update the configured admin    |
| `npm run lint`             | Run ESLint with zero warnings            |
| `npm run typecheck`        | Check TypeScript without emitting files  |
| `npm test`                 | Run Vitest in watch mode                 |
| `npm run test:run`         | Run the test suite once                  |
| `npm run test:runtime`     | Load compiled modules using native Node  |
| `npm run test:auth-server` | Start disposable browser-test backend    |
| `npm run test:coverage`    | Run tests with coverage                  |
| `npm run format`           | Format supported files                   |
| `npm run format:check`     | Check formatting without modifying files |

## Environment

Copy `.env.example` to `.env`. Set `MONGODB_URI`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, and a local-only `SEED_ADMIN_PASSWORD` before running the seed command. The application validates configuration before opening a port and refuses unsafe production combinations. Never commit `.env` or real credentials.

## Vercel deployment

The root `index.ts` exports the Express application for Vercel; `src/server.ts` remains the standalone server with graceful shutdown. Both use the same route composition. Vercel connects to MongoDB lazily, shares one in-flight connection per instance, reuses warm connections, and caps each pool at five connections. Health checks do not require MongoDB; readiness checks do.

Login throttling uses atomic MongoDB counters shared across instances, not process-local memory. Keys are digests, windows are 15 minutes, expired counters have a TTL index, and throttled responses include `Retry-After`. If the shared store is unavailable, sign-in fails closed.

Before deploying, create all schema-defined indexes (including `login_attempt_expiry_ttl`) and seed the administrator explicitly from a trusted local environment. Production disables automatic index creation. Do not upload seed passwords to the hosting service.

Set these production-only variables in the backend project's Vercel environment:

| Variable           | Value                                                          |
| ------------------ | -------------------------------------------------------------- |
| `NODE_ENV`         | `production`                                                   |
| `MONGODB_URI`      | Server-only Atlas connection string; mark sensitive            |
| `FRONTEND_ORIGIN`  | Exact HTTPS production frontend origin                         |
| `COOKIE_SECURE`    | `true`                                                         |
| `TRUST_PROXY_HOPS` | `1` for the Vercel-managed proxy; reassess if topology changes |

The frontend sets server-only `API_PROXY_TARGET` to this backend's HTTPS origin and keeps browser requests on `/api/v1`. Session cookies stay HttpOnly, Secure, host-only, and scoped to `/api/v1`. Production Atlas credentials must not be made available to preview builds or the browser. Use separate infrastructure if authenticated previews are needed.

`vercel.json` selects the Express framework and one Mumbai function region near the Atlas cluster. A Hobby deployment has dynamic outbound IPs; any broader Atlas network allowlist must be an explicit operator decision. Database authentication and TLS remain mandatory. Never enable paid networking automatically.

Verify `/health`, `/ready`, authentication, origin enforcement, private/no-store responses, and actual CRUD workflows after deployment. A successful build alone is not a successful release.

## API contract

- OpenAPI draft: [`docs/openapi.yaml`](./docs/openapi.yaml)
- Accepted architecture decisions: [`docs/architecture-decisions.md`](./docs/architecture-decisions.md)

## Current implementation status

Phases 01-02 establish the service foundation, MongoDB lifecycle, administrator persistence, Argon2id password hashing, explicit seeding, origin enforcement, login throttling, and revocable `HttpOnly` sessions.

Phase 03 adds authenticated doctor creation (`POST /api/v1/doctors`), listing (`GET /api/v1/doctors`), and detail (`GET /api/v1/doctors/:doctorId`). Lists support literal prefix search, exact specialization/hospital filters, creation-date ranges, four stable sorts, and pagination capped at 100 records per page. Unknown fields and invalid queries return the documented validation envelope. Duplicate normalized emails return `409`.

Index choices and measured fixture plans are documented in [`docs/doctor-query-plans.md`](./docs/doctor-query-plans.md). The disposable browser-test server also mounts the doctor routes for upcoming frontend integration work.

Phase 04 adds doctor-scoped patient creation/listing/deletion and global patient listing/detail/patch/deletion. Patient creation and deletion update `Doctor.patientCount` in the same MongoDB transaction. Partial updates preserve at least one contact method even under concurrent edits. The doctor association is immutable. All routes require authentication, mutations require a trusted Origin, and responses disable caching.

Transaction rules, null/date semantics, failure behavior, and measured patient index plans are documented in [`docs/patient-api.md`](./docs/patient-api.md).

Phase 05 adds `GET /api/v1/dashboard/summary`: all-time doctor/patient totals, a rounded average, range-specific patient creation totals, zero-filled daily trends, and up to ten ranked doctors. Queries accept local calendar dates and an IANA time zone, with inclusive start, exclusive end, and a 366-day maximum. Reads require authentication and disable caching. Boundary rules, consistency semantics and measured query plans are documented in [`docs/dashboard-analytics.md`](./docs/dashboard-analytics.md).

## Authentication browser tests

`npm run test:auth-server` starts the actual authentication, doctor, patient, and dashboard routes on port 4000 with an isolated, temporary MongoDB replica set. It creates the fictional account `browser-test@example.test` with password `fictional-browser-verification-only`. It does not read `.env` or connect to Atlas. All fixture data is discarded when the process stops.

Run the frontend's authentication browser suite against this process from `http://localhost:3000`. Production origin validation remains enabled. Use these fixture credentials only for the disposable test server. To check the compiled application's native module loading, run `npm run build` followed by `npm run test:runtime`.

To verify changes without clearing a running preview's temporary records, launch a separate fixture with `BROWSER_TEST_API_PORT=4001 BROWSER_TEST_FRONTEND_ORIGIN=http://localhost:3001 npm run test:auth-server`. Configure the frontend browser suite with `E2E_BASE_URL=http://localhost:3001` and `API_PROXY_TARGET=http://localhost:4001`. These overrides apply only to the disposable browser helper; they do not change application defaults or bypass origin checks.
