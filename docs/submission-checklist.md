# Backend handoff

Both services are deployed already. This phase finalizes documentation and reproducibility, not another infrastructure rollout or release tag.

## Requirement evidence

| Area                                           | Evidence                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate Node/Express REST service and MongoDB | Standalone/serverless adapters share `createRuntimeApp`; Next.js is a separate repository and process.                                        |
| Administrator-only protected portal            | Opaque revocable session cookie, active-admin checks, Argon2id, exact Origin and shared login/API limits.                                     |
| Doctor and scoped/global patient operations    | Canonical OpenAPI plus real-route integration tests for CRUD, filtering, pagination, conflicts and transaction races.                         |
| Operational analytics                          | Time-zone-aware range tests, zero-filled daily series, all-time totals/ranking and measured aggregation/index reports.                        |
| Validation/error/query performance             | Strict DTOs, safe request-ID envelopes, stable ordering, escaped prefix queries, documented explain evidence and bounded isolated load tests. |
| README requirements                            | Pitch/live links, exact setup/env/scripts, flow diagram, two decision deep dives, limitations and frontend visual evidence link.              |
| Contract publication                           | Validated OpenAPI 3.1 served read-only at `/api-docs/openapi.json`; no interactive production explorer.                                       |

## Reviewer links

- [Application](https://doctor-tracker-shoyeb.vercel.app)
- [Frontend repository and screenshots](https://github.com/ShoyebWritesCode/Doctor-Tracker-Frontend#readme)
- [Backend repository](https://github.com/ShoyebWritesCode/Doctor-Tracker-Backend)
- [API contract](https://doctor-tracker-api-shoyeb.vercel.app/api-docs/openapi.json)
- [Liveness](https://doctor-tracker-api-shoyeb.vercel.app/health) / [readiness](https://doctor-tracker-api-shoyeb.vercel.app/ready)

Share the production demo password privately with the reviewer; do not commit it or place it in screenshots. No submission has been sent on the owner's behalf. Local fixture credentials are intentionally public, fictional and isolated from production.

## Reproducibility and safe checks

Follow the README in a fresh directory. The no-Atlas path runs the real application routes against a new temporary replica set; `BROWSER_TEST_DEMO_DATA=1` adds the synthetic 24-doctor/256-patient dataset only inside that fixture. Standard tests remain empty-fixture tests. Persistent setup requires an explicit replica-set URI and a chosen administrator password. The optional Docker recipe is documented but not claimed as executed on this host.

Run formatting, lint, strict types, all-source test coverage, production compilation and native-Node import checks. OpenAPI validation rejects duplicate YAML keys/unresolved references; JSON Schema assertions exercise real health/readiness, login, doctor/patient/list, dashboard and error responses. Existing integration suites cover patch/delete/expiry/conflicts/security behavior in greater depth. Documentation testing does not replace those suites.

Public health/readiness/OpenAPI endpoints are safe read-only deployed checks. Do not run load, destructive smoke tests, re-seeding or reset operations against the deployed demonstration database. Preserve existing Atlas/origin/cookie/proxy settings. Ordinary pushes can still trigger the already configured automatic Vercel deployment.

## Explicit limitations

Free demo hosting is not evidence of managed backups, restore drills, strict network isolation or production SLAs. Local shutdown/load/explain tests are not production-scale or serverless lifecycle guarantees. No real records, compliance claim, MFA/recovery/extra roles, immutable audit history or recovery UI is provided. Patient deletion is permanent. The frontend spoken-output screen-reader spot check remains deferred by the owner.

Before actual health-data use, perform a separate security/privacy/retention review, restrict infrastructure access, establish backups and restoration, define observability/response procedures, and validate representative capacity. These are not silently marked complete by a successful demonstration deployment.
