# Dashboard analytics

`GET /api/v1/dashboard/summary?from=2026-01-01&to=2026-01-04&timezone=Asia%2FDhaka`

Requires an administrator session. Responses, including errors, use `Cache-Control: private, no-store`. Unknown keys, duplicate parameters, timestamps, invalid dates, offset-only zones, reversed/equal bounds, and intervals over 366 calendar days return the normal validation envelope. Time zone defaults to `Asia/Dhaka`; named zones are canonicalized using the runtime's IANA rules.

## Metric semantics

- Doctor/patient totals and their rounded two-decimal average cover all current records. The average is `0` with no doctors.
- Only `patientsCreatedInRange` and `patientsByDate` use the selected range. The range count is summed from the same aggregation as the series, so they reconcile without an independently timed count query.
- Every requested calendar date has a bucket, including zero-count days. Empty collections still produce date buckets, not `null` or an empty chart.
- Ranking returns at most ten doctors by transactionally maintained all-time patient count descending, then stored case-sensitive name ascending (binary ordering), then ID ascending. Zero-patient doctors are included if they fit. Only ID, name and count are projected.

Independent count, trend and ranking reads run concurrently. There is no cache or cross-query snapshot guarantee: concurrent writes can commit between independent reads. Subsequent requests reflect committed writes. At rest, totals and rankings reconcile with source records. A future single-snapshot requirement should be implemented explicitly rather than implied.

## Calendar boundaries

The frozen frontend/OpenAPI contract uses `YYYY-MM-DD`, not timestamp query parameters. `@js-temporal/polyfill` supplies calendar/time-zone operations on Node 22. Each boundary is converted independently to an instant; a local day need not be 24 hours. A skipped midnight uses the first valid local instant; a date skipped by a dateline change remains a zero-filled calendar label.

MongoDB receives an indexable `createdAt: { $gte: start, $lt: end }` match before `$dateToString` grouping in the selected zone and ascending date sorting. Missing labels are filled with calendar-day iteration, not elapsed-hour arithmetic. Keep Node ICU/IANA and MongoDB time-zone data current when deploying.

Tests cover inclusive/exclusive Dhaka edges, New York's 23/25-hour DST days and repeated hour, São Paulo's skipped midnight, leap day, and Apia's skipped date. Historical creation timestamps are assigned only in isolated fixtures; normal patient patch routes cannot edit them. See the [Temporal calendar API](https://tc39.es/proposal-temporal/docs/plaindate.html) and [MongoDB date grouping](https://www.mongodb.com/docs/manual/reference/operator/aggregation/datetostring/) documentation.

## Measured query plans

`tests/integration/dashboard-query-plans.test.ts` uses 2,000 fictional doctors and 2,000 patients. The first 100 doctors each have 20 patients. Creation times span 2,000 hours; the two-day range matches 48 patients. Ranking is measured before/after adding its index without a forced ranking or trend hint.

| Query                                           | Keys examined | Documents examined | Result                               |
| ----------------------------------------------- | ------------: | -----------------: | ------------------------------------ |
| Two-day trend, existing `patient_created` index |            48 |                  0 | 2 daily groups, 24 patients each     |
| Top ten without ranking index                   |             0 |              2,000 | Blocking sort                        |
| Top ten with `doctor_patient_ranking`           |            10 |                  0 | Covered index scan; no blocking sort |

The new ranking index is `{ patientCount: -1, name: 1, _id: 1 }`. Its write/storage cost is justified by the measured removal of a full scan and sort. The existing patient creation index is sufficient; no redundant date index is added. All-time counts explicitly use `_id_` to avoid empty-filter collection scans, but exact counts still require work proportional to index cardinality. These fixture measurements are not production latency guarantees.

Each database query has a 5-second execution ceiling. The 366-day bound caps grouping/output cardinality, not matching patients. There is no speculative cache to invalidate; profile deployment data before adding one. Run `npm run test:run` to reproduce correctness and explain-plan checks without Atlas.

Production disables automatic index creation. Add the ranking index during deployment preparation, then recheck the query plan against the deployment dataset:

```javascript
db.doctors.createIndex({ patientCount: -1, name: 1, _id: 1 }, { name: "doctor_patient_ranking" });
```
