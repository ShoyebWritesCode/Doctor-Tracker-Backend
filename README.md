# Doctor Tracker API

The standalone REST API for Doctor Tracker, an authenticated administrative application for managing doctors, their patients, and operational analytics. The service is built with Express, strict TypeScript, MongoDB, and revocable opaque sessions.

## Prerequisites

- Node.js `22.17.1`
- npm `10.9.2`

## Local setup

```bash
cp .env.example .env
npm ci
npm run seed:admin
npm run dev
```

The API listens on `http://localhost:4000` by default. Check process liveness at `GET /health` and MongoDB readiness at `GET /ready`. The seed command is explicit and idempotent; application startup never creates accounts.

## Commands

| Command                 | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `npm run dev`           | Run the API in watch mode                |
| `npm run build`         | Compile production JavaScript to `dist/` |
| `npm start`             | Run the compiled server                  |
| `npm run seed:admin`    | Create or update the configured admin    |
| `npm run lint`          | Run ESLint with zero warnings            |
| `npm run typecheck`     | Check TypeScript without emitting files  |
| `npm test`              | Run Vitest in watch mode                 |
| `npm run test:run`      | Run the test suite once                  |
| `npm run test:coverage` | Run tests with coverage                  |
| `npm run format`        | Format supported files                   |
| `npm run format:check`  | Check formatting without modifying files |

## Environment

Copy `.env.example` to `.env`. Set `MONGODB_URI`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, and a local-only `SEED_ADMIN_PASSWORD` before running the seed command. The application validates configuration before opening a port and refuses unsafe production combinations. Never commit `.env` or real credentials.

## API contract

- OpenAPI draft: [`docs/openapi.yaml`](./docs/openapi.yaml)
- Accepted architecture decisions: [`docs/architecture-decisions.md`](./docs/architecture-decisions.md)

## Current implementation status

Phases 01-02 establish the service foundation, MongoDB lifecycle, administrator persistence, Argon2id password hashing, explicit seeding, origin enforcement, login throttling, and revocable `HttpOnly` sessions.
