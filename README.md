# Doctor Tracker API

The standalone REST API for Doctor Tracker, an authenticated administrative application for managing doctors, their patients, and operational analytics. The service is built with Express and strict TypeScript; MongoDB persistence and session authentication are introduced in the next implementation phase.

## Prerequisites

- Node.js `22.17.1`
- npm `10.9.2`

## Local setup

```bash
cp .env.example .env
npm ci
npm run dev
```

The API listens on `http://localhost:4000` by default. Check liveness at `GET /health`.

## Commands

| Command                 | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `npm run dev`           | Run the API in watch mode                |
| `npm run build`         | Compile production JavaScript to `dist/` |
| `npm start`             | Run the compiled server                  |
| `npm run lint`          | Run ESLint with zero warnings            |
| `npm run typecheck`     | Check TypeScript without emitting files  |
| `npm test`              | Run Vitest in watch mode                 |
| `npm run test:run`      | Run the test suite once                  |
| `npm run test:coverage` | Run tests with coverage                  |
| `npm run format`        | Format supported files                   |
| `npm run format:check`  | Check formatting without modifying files |

## Environment

Copy `.env.example` to `.env`. The application validates configuration before opening a port and refuses unsafe production combinations. Seed credentials are placeholders for the explicit seed script added during the authentication phase; startup never seeds data.

## API contract

- OpenAPI draft: [`docs/openapi.yaml`](./docs/openapi.yaml)
- Accepted architecture decisions: [`docs/architecture-decisions.md`](./docs/architecture-decisions.md)

## Current implementation status

Phase 01 establishes the service foundation: application/server separation, validated environment, structured logging, request IDs, safe error responses, tests, and CI. Database-backed features are implemented in subsequent phases.
