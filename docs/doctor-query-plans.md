# Doctor query verification

The integration test `tests/integration/doctor-query-plans.test.ts` inserts 2,000 fictional doctors into an isolated MongoDB instance, creates the declared indexes, and runs the same filter, projection, sorting, and page size used by the list service. It inspects the winning plan and `executionStats` without forcing an index hint.

The fixture includes 10 specialties, 40 hospitals, unique emails, a 1% search-prefix match rate, and increasing creation timestamps. The default page size is 20.

| Query                                    | Winning indexes                                                 | Returned | Documents examined | Keys examined |
| ---------------------------------------- | --------------------------------------------------------------- | -------- | ------------------ | ------------- |
| Default newest first                     | `doctor_created`                                                | 20       | 20                 | 20            |
| Exact specialization                     | `doctor_specialization_created`                                 | 20       | 20                 | 20            |
| Exact hospital                           | `doctor_hospital_created`                                       | 20       | 20                 | 20            |
| Specialization and hospital              | `doctor_hospital_created`                                       | 20       | 20                 | 20            |
| Prefix search across name/email/hospital | `doctor_email_unique`, `doctor_hospital_created`, `doctor_name` | 20       | 20                 | 40            |
| Ascending normalized name                | `doctor_name`                                                   | 20       | 20                 | 20            |

These are observed local fixture results, not production performance guarantees. The regression test allows the planner to choose either exact-filter index for combined filters. Search may require an in-memory sort after the indexed OR. Changing selectivity, sorting, skip depth, or collection size can change the winning plan and work performed.

## Index decisions

- Unique email both enforces concurrent creation conflicts and supports email-prefix lookup.
- Creation date and ID support the default ordering in either direction.
- Specialization/date/ID and hospital/date/ID serve exact filters while preserving stable ordering.
- Normalized name and ID support name ordering and name-prefix search.
- Hospital-prefix search reuses the hospital/date/ID index. No redundant standalone hospital index or text index is added.
- Combined filters use the more selective available index and apply the other predicate while fetching. Add a combined index only if production query frequency and examined-document counts justify its write/storage cost.

Prefix patterns are anchored, escaped, and matched against normalized stored fields without the `i` flag. Search, filtering, and pagination happen in MongoDB. Data and total-count queries run concurrently; totals are current per query and are not promised as a transactional snapshot during concurrent writes.

Deep page offsets and broad searches can still require increasing work. Page/limit input must be safe integers; limits above 100 are rejected. Cursor pagination and workload-specific index changes remain the scale path. Recheck these hypotheses on the deployment dataset before release.

Run `npm run test:run` to reproduce the plans and correctness scenarios without Atlas. Test output prints the selected indexes and examination counts.
