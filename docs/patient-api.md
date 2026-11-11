# Patient API

Patient operations require an active administrator session. Mutations enforce the configured frontend Origin; the test-only bypass applies only when NODE_ENV is `test` and Origin is omitted. All patient responses use `Cache-Control: private, no-store`.

| Method | Route                                           | Result                                                                      |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------- |
| POST   | `/api/v1/doctors/:doctorId/patients`            | Create patient and increment doctor count; 201 with global patient Location |
| GET    | `/api/v1/doctors/:doctorId/patients`            | Doctor-scoped list; missing doctor returns 404                              |
| DELETE | `/api/v1/doctors/:doctorId/patients/:patientId` | Delete only within the specified doctor; 204                                |
| GET    | `/api/v1/patients`                              | Global filtered list with projected doctor ID/name                          |
| GET    | `/api/v1/patients/:patientId`                   | Public patient representation                                               |
| PATCH  | `/api/v1/patients/:patientId`                   | Update mutable fields; doctor association cannot change                     |
| DELETE | `/api/v1/patients/:patientId`                   | Delete patient and decrement associated doctor count; 204                   |

Lists accept page, limit, search, condition, status, createdFrom, createdTo, and sort. The global list additionally accepts doctorId. Unknown/repeated parameters, MongoDB operators, invalid IDs/dates, and invalid pagination fail with the standard 400 envelope. A valid nonexistent global doctor filter returns an empty list; a scoped route must first resolve its doctor.

## Persistence and transaction rules

MongoDB must support transactions. Use Atlas or a local replica set (the example URI specifies `replicaSet=rs0`). A standalone MongoDB process does not satisfy the deployment contract; the service does not silently fall back to independent writes.

Creation resolves the doctor and increments its count, then inserts the patient in one snapshot transaction with majority write concern. Deletion verifies ownership, removes the patient, and decrements its doctor in one transaction. A failed decrement or insertion aborts the whole operation. Decrement requires a positive existing count; inconsistent preexisting data produces a safe internal error and preserves the patient instead of allowing a negative count. A repeated deletion returns 404 without changing the count again.

Partial update reads, merges, checks contacts, and saves within a transaction. Concurrent attempts to clear different contact fields cause a write conflict and retry; the retried operation validates the latest state. Removing the last contact returns 400. Transaction callbacks contain no external notifications or other irreversible effects.

Tests inject insertion/decrement failures and exercise concurrent creation, duplicate deletion, cross-doctor deletion, and contact removal against a real temporary replica set. Counts are compared with direct patient counts after each successful or rolled-back mutation. The test server and suite require no Atlas account or `.env`.

## Representation and validation

- Doctor association, IDs, timestamps, and normalized search keys cannot be supplied through patch/create bodies.
- Name, condition, and status are required on creation. At least one valid email or phone is required.
- Create omits unused optional fields. Patch uses explicit null to clear an optional field. Empty patches fail.
- Email is trimmed and lowercased. Display names/conditions preserve casing. Normalized search fields use NFKC, collapsed whitespace, and lowercase.
- Phone display formatting is preserved; phone-prefix matching removes spaces, parentheses, plus signs, dots and hyphens consistently from both stored keys and query input. It does not infer country codes or equate local and international numbers.
- Birth date is a validated calendar string, never converted to a timestamp. Last visit is a timestamp normalized to UTC. Null last visits sort before dates ascending and after dates descending, with ID as the tiebreaker.
- Notes are limited to 1,000 characters. Bodies, notes, contact values, and raw query strings are not logged. Unexpected request errors log their classification and request ID, excluding database error messages that can embed submitted values.
- Output contains a doctor ID/name summary and explicit nulls for missing optional fields. Internal normalized fields, `_id`, and version fields are excluded by projection and serialization.

## Query and index verification

`tests/integration/patient-query-plans.test.ts` uses 2,000 fictional records, ten doctor references, twenty conditions and three statuses. It executes the production filter, projection and sort without index hints. Doctor projection uses one batched populate per result page; these measurements cover the patient lookup before that populate.

| Query                | Observed winning index                                         | Returned | Documents examined | Keys examined |
| -------------------- | -------------------------------------------------------------- | -------- | ------------------ | ------------- |
| Default newest first | `patient_created`                                              | 20       | 20                 | 20            |
| Doctor               | `patient_doctor_created`                                       | 20       | 20                 | 20            |
| Condition            | `patient_condition_created`                                    | 20       | 20                 | 20            |
| Status               | `patient_status_created`                                       | 20       | 20                 | 20            |
| Doctor and condition | `patient_condition_created`                                    | 20       | 20                 | 20            |
| Name sort            | `patient_name`                                                 | 20       | 20                 | 20            |
| Last visit sort      | `patient_last_visit`                                           | 20       | 20                 | 20            |
| Prefix search        | `patient_name`, `patient_email_prefix`, `patient_phone_prefix` | 20       | 20                 | 40            |

Each declared index serves one of these verified access patterns. No combined doctor/condition or text index is added. Prefix search escapes regular-expression operators and uses anchored patterns against normalized keys. Data/count queries run concurrently and do not promise one transactional snapshot during concurrent writes. Search may perform a blocking sort. Deep offsets and broad predicates require more work; fixture results are regression evidence, not production performance guarantees. Recheck selectivity and index costs on representative deployment data before release.
