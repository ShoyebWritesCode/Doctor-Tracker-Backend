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

## API contract

- OpenAPI draft: [`docs/openapi.yaml`](./docs/openapi.yaml)
- Accepted architecture decisions: [`docs/architecture-decisions.md`](./docs/architecture-decisions.md)

## Current implementation status

Phases 01-02 establish the service foundation, MongoDB lifecycle, administrator persistence, Argon2id password hashing, explicit seeding, origin enforcement, login throttling, and revocable `HttpOnly` sessions.

Phase 03 adds authenticated doctor creation (`POST /api/v1/doctors`), listing (`GET /api/v1/doctors`), and detail (`GET /api/v1/doctors/:doctorId`). Lists support literal prefix search, exact specialization/hospital filters, creation-date ranges, four stable sorts, and pagination capped at 100 records per page. Unknown fields and invalid queries return the documented validation envelope. Duplicate normalized emails return `409`.

Index choices and measured fixture plans are documented in [`docs/doctor-query-plans.md`](./docs/doctor-query-plans.md). The disposable browser-test server also mounts the doctor routes for upcoming frontend integration work.

Phase 04 adds doctor-scoped patient creation/listing/deletion and global patient listing/detail/patch/deletion. Patient creation and deletion update `Doctor.patientCount` in the same MongoDB transaction. Partial updates preserve at least one contact method even under concurrent edits. The doctor association is immutable. All routes require authentication, mutations require a trusted Origin, and responses disable caching.

Transaction rules, null/date semantics, failure behavior, and measured patient index plans are documented in [`docs/patient-api.md`](./docs/patient-api.md).

## Authentication browser tests

`npm run test:auth-server` starts the actual authentication, doctor, and patient routes on port 4000 with an isolated, temporary MongoDB replica set. It creates the fictional account `browser-test@example.test` with password `fictional-browser-verification-only`. It does not read `.env` or connect to Atlas. All fixture data is discarded when the process stops.

Run the frontend's authentication browser suite against this process from `http://localhost:3000`. Production origin validation remains enabled. Use these fixture credentials only for the disposable test server. To check the compiled application's native module loading, run `npm run build` followed by `npm run test:runtime`.
