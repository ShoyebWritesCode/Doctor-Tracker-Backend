# Testing and performance evidence

## Reproduction and safety

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:runtime
npm run test:load
```

Integration tests create their own `MongoMemoryServer` or single-member `MongoMemoryReplSet` instances. Their database URIs come from those instances, not from `MONGODB_URI`. Transaction, count, ownership, seed and workflow tests use actual MongoDB persistence. Error-injection cases elsewhere in the suite are labeled as such; the lifecycle and performance scenarios do not replace Mongoose with mocks.

The explicit load harness accepts **no target arguments**, does not import dotenv, connects only to its newly created replica set, and opens random loopback ports. It cannot be pointed at Atlas or a deployed URL through an environment variable. It tears down its own listeners, connection and replica set in `finally`. Its only collection reset occurs inside the owned fixture between two independent login-limit experiments. Never adapt this into an unbounded production stress test or reuse production credentials.

## Coverage and correctness

The suite currently contains 241 tests across 19 files. Important behavior includes:

| Area                                 | Evidence                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration and session primitives | Production safety, Argon2id, opaque token hashing, exact cookie-name parsing, malformed encoding, clearing scope and Secure/HttpOnly/SameSite behavior                                         |
| List boundaries                      | Defaults, safe integer offsets, caps, allowed sorts, ID tie-breakers, Unicode/phone normalization, literal regex escaping and inclusive/exclusive dates                                        |
| Persistence and workflows            | Real doctor/patient CRUD, ownership, patch allowlists, count/transaction rollback and concurrent-contact/count invariants                                                                      |
| Full router composition              | `administrator-lifecycle.test.ts` signs in, creates and filters records, edits, rejects cross-doctor deletion, reconciles dashboard/counts, deletes, signs out and rejects the revoked session |
| Representative seed                  | Stable fictional IDs, no duplicate/inflated counts, preserved edits, conflict rollback, API/list/status/ranking/daily-series reconciliation                                                    |
| Dashboard and security               | Zero-fill, DST/calendar edges, ranking/ties, response privacy, shared/concurrent throttling, origin/body limits and safe telemetry                                                             |

V8 coverage includes **all `src/**/*.ts` files**, including unimported startup code; only declaration files are excluded. The measured result on 2026-11-11 was 87.70% statements, 86.57% branches, 91.62% functions and 88.39% lines. Earlier imported-file-only coverage is not directly comparable to this broader denominator. CI enforces global floors of 85/80/90/85 respectively, not a claim of complete proof.

The standalone `server.ts` process bootstrap/signal wiring and portions of explicit seed CLI wrappers are not exercised by in-process coverage. Extracted listener draining/deadline behavior is tested over actual HTTP sockets; compiled runtime composition is initialized without connecting to a database. Host deployment smoke checks remain a separate release gate. Coverage does not prove security, model production failures, or replace deployment verification.

The public demo intentionally remains 24 doctors/256 patients across 12 specialties. The independent performance fixture has 40 doctors, 400 patients and one administrator, satisfying the planned load distribution without rewriting the live dataset.

## Exact-count optimization: measured work, not a new index

The paginated doctor and global patient services originally used an unhinted `countDocuments({})` for their default totals. The installed MongoDB driver's count API runs `$match` followed by a counting `$group`. Its scalar result API does not expose the raw explain document, so the test explains the identical aggregation and separately monitors real service commands to verify the actual hint.

`tests/integration/count-query-plans.test.ts` uses 2,000 fictional records per collection. Both default counts produced:

| Query shape                               | Documents examined | Index keys examined |
| ----------------------------------------- | -----------------: | ------------------: |
| Original empty-filter exact count         |              2,000 |                   0 |
| Existing `_id_` index explicitly selected |                  0 |               2,000 |

Only empty-filter counts now select `_id_`. Filtered/scoped counts retain the query planner's selective index choice; command-monitoring assertions protect both behaviors. No collection indexes are created, dropped or hinted for ordinary list row retrieval by this change. Counts remain **exact, O(N) index work**, not constant-time estimates. Separate list/count reads still do not promise a snapshot during concurrent writes.

Existing explain-plan fixtures additionally cover:

- Doctor default/specialization/hospital/combined/name-sort/prefix-search access on 2,000 doctors: default/exact/name paths examine 20 documents for a 20-row page; search uses the indexed OR and may require an in-memory sort.
- Global/scoped/condition/status/name/last-visit/search patient access on 2,000 patients, with bounded fixture-specific scan budgets.
- A two-day patient trend: 48 index keys and zero fetched documents for 48 matching records.
- Doctor ranking: the already-added ranking index reduces 2,000 fetched documents plus a blocking sort to ten index keys and zero fetched documents. Its before/after test drops/recreates an index **only in its disposable fixture**.

See [doctor plans](./doctor-query-plans.md), [patient plans](./patient-api.md) and [dashboard plans](./dashboard-analytics.md). These measurements constrain known fixture shapes, not every combination or cardinality. Deep skip offsets, broad prefixes, different selectivity and the all-time exact counts still increase work.

## Index inventory review

| Index group                                                                                                                                   | Reason retained                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Doctor unique email; created/ID; specialization/created/ID; hospital/created/ID; normalized-name/ID; count/name/ID                            | Uniqueness, stable ordering, exact/prefix filters and covered ranking                         |
| Patient created/ID; doctor/created/ID; condition/created/ID; status/created/ID; normalized-name/ID; last-visit/ID; email and normalized phone | Default/scoped/filter/sort/prefix query shapes                                                |
| Administrator unique email; session token unique; session expiry TTL                                                                          | Identity lookup, session lookup and expiry                                                    |
| Session administrator lookup                                                                                                                  | Deliberate session-maintenance/revocation access path; not claimed as a hot portal query      |
| Login/request-counter TTL indexes                                                                                                             | Retention of temporary shared limiter records; counter increments use their unique ID indexes |

No redundant standalone doctor/hospital/date indexes or speculative combined indexes were found to remove. No index was dropped merely because it was absent from one warm fixture's `$indexStats`. The measured optimization reuses existing `_id_` indexes, so it needs no Atlas index migration or credentials/environment changes.

## Bounded local HTTP load smoke

Command: `npm run test:load`. Latest recorded run: **2026-11-11 17:35:31 UTC**.

- Linux x64, Node 22.17.1, MongoDB 8.2.6, Intel Core i7-1355U, 12 available logical CPUs, approximately 15 GiB host memory. Shared machine scheduling is uncontrolled; these are observed host resources, not reserved allocations.
- One Node process, actual Express runtime/security/auth middleware, one local MongoDB replica-set member, pool capped at five connections, application logging silent. No TLS, Vercel proxy, Atlas network hop, cold starts or distributed machines are represented.
- Deterministic synthetic fixture anchored at `2026-11-11T12:00:00Z`: 40 doctors, 400 patients, varied specialties/statuses/dates, and a zero-patient doctor. Counter invariants are checked against actual patient records afterward.
- Sixteen sequential warm-up reads, then 400 successful reads at concurrency eight, round-robin across eight routes (50 samples each). Latency includes loopback HTTP and response-body parsing/validation. Every response must be 200 and reconcile its list/dashboard data; timing is not a pass/fail threshold.

| Route group                     | p50 (ms) | p95 (ms) | p99/max (ms) |
| ------------------------------- | -------: | -------: | -----------: |
| Doctor default list             |    29.73 |    41.15 |        44.58 |
| Doctor prefix search            |    32.01 |    42.55 |        47.42 |
| Doctor specialization filter    |    28.80 |    42.92 |        52.78 |
| Global patient list             |    30.58 |    44.88 |        45.50 |
| Patient status filter           |    31.50 |    46.45 |        50.29 |
| Global doctor-filtered patients |    31.69 |    44.15 |        49.68 |
| Doctor-scoped patients          |    37.32 |    53.03 |        68.02 |
| Thirty-day dashboard            |    27.67 |    41.71 |        63.33 |

All 400 reads passed in approximately 1,648 ms (observed aggregate 243 requests/second in this short run). This is a **correctness-oriented smoke**, not a saturation test, SLA, sustainable-throughput result, or claim about Vercel/Atlas. Fifty samples per route make p99 equal the observed maximum. An earlier pre-change run was also successful; its small latency differences are not sufficient to attribute a speedup. The performance claim is reduced document fetching in the explain plans above.

### Login limits under concurrency

These are deliberately small correctness experiments against the local fixture, **not password-hashing throughput benchmarks**:

- Twenty invalid sign-ins at concurrency eight, alternating two application instances and differently cased/spaced versions of one unknown account: exactly five admitted generic 401 failures and fifteen 429 responses for an account budget of five. Shared Mongo counters prevent an instance split from doubling the budget.
- Reset only the owned fixture's login counter collection, then twenty unknown-account attempts at concurrency eight with an IP budget of ten: exactly ten 401 failures and ten 429 responses. Different accounts do not bypass the IP budget.
- Throttled responses must include positive `Retry-After`; rejected attempts must not create sessions. The harness refuses a result if the experiment crosses its 15-minute window boundary. It logs no passwords, cookie values, account/IP counter keys, or user data.

The short durations mix immediately rejected requests with costly password verification, so their aggregate request rates must not be used as an Argon2 capacity metric. Load smoke is explicit rather than a noisy machine-speed gate in CI; deterministic request/transaction/index/limiter assertions run in CI on every change.
