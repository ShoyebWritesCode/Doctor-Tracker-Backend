import assert from "node:assert/strict";
import { availableParallelism, cpus, totalmem, platform, arch } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { z } from "zod";
import { createRuntimeApp } from "../../src/runtime.js";
import { parseEnv } from "../../src/config/env.js";
import { createHttpServer, closeHttpServer } from "../../src/common/http/server-policy.js";
import { AdminModel } from "../../src/modules/auth/admin.model.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { LoginAttemptModel } from "../../src/modules/auth/login-attempt.model.js";
import { RequestLimitModel } from "../../src/common/http/request-limit.model.js";
import { DoctorModel } from "../../src/modules/doctors/doctor.model.js";
import { PatientModel } from "../../src/modules/patients/patient.model.js";
import { hashPassword } from "../../src/modules/auth/password.js";
import { buildDemoData } from "../../src/scripts/demo-data.js";
import { createTestLogger } from "../helpers/logger.js";

// No dotenv import, external URL/URI option, or reusable database. This script owns
// its MongoMemoryReplSet and random loopback listeners from creation to teardown.
assert.equal(process.argv.length, 2, "This isolated harness does not accept target arguments.");
assert.equal(mongoose.connection.readyState, mongoose.STATES.disconnected);
const ORIGIN = "http://localhost:3000";
const fixtureDate = new Date("2026-11-11T12:00:00Z");
const logger = createTestLogger();
const servers: Server[] = [];
let mongo: MongoMemoryReplSet | undefined;
const listEnvelope = z.object({
  data: z.array(z.object({ id: z.string() })),
  meta: z.object({ total: z.number() }),
});
const dashboardEnvelope = z.object({
  data: z.object({
    totals: z.object({
      doctors: z.number(),
      patients: z.number(),
      patientsCreatedInRange: z.number(),
    }),
    patientsByDate: z.array(z.object({ count: z.number() })),
  }),
});

function latency(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (percent: number) =>
    Math.round((sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)] ?? 0) * 100) / 100;
  return { samples: values.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: at(1) };
}

async function load(
  requests: number,
  concurrency: number,
  job: (index: number) => Promise<{ status: number; group: string }>,
) {
  let next = 0;
  const samples = new Map<string, number[]>();
  const statuses: Record<string, number> = {};
  const started = performance.now();
  const workers = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        const index = next++;
        const start = performance.now();
        const result = await job(index);
        const values = samples.get(result.group) ?? [];
        values.push(performance.now() - start);
        samples.set(result.group, values);
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      }
    }),
  );
  const failures = workers.filter((result) => result.status === "rejected");
  assert.equal(failures.length, 0, "A workload request or response validation failed.");
  assert.equal(
    Object.values(statuses).reduce((sum, count) => sum + count, 0),
    requests,
  );
  const durationMs = performance.now() - started;
  return {
    requests,
    concurrency,
    durationMs: Math.round(durationMs),
    observedRequestsPerSecond: Math.round((requests / durationMs) * 1000),
    statuses,
    groups: Object.fromEntries(Array.from(samples, ([name, values]) => [name, latency(values)])),
  };
}

async function main() {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongo.getUri("doctor_tracker_load_fixture");
  await mongoose.connect(uri, { autoIndex: false, maxPoolSize: 5, minPoolSize: 0 });
  assert.equal(mongoose.connection.name, "doctor_tracker_load_fixture");
  await Promise.all([
    AdminModel.createIndexes(),
    SessionModel.createIndexes(),
    LoginAttemptModel.createIndexes(),
    RequestLimitModel.createIndexes(),
    DoctorModel.createIndexes(),
    PatientModel.createIndexes(),
  ]);
  const sample = buildDemoData(fixtureDate);
  const doctors = Array.from({ length: 40 }, (_, index) => ({
    ...sample.doctors[index % sample.doctors.length]!,
    _id: new mongoose.Types.ObjectId((index + 1).toString(16).padStart(24, "0")),
    name: `${sample.doctors[index % sample.doctors.length]!.name} Fixture ${index}`,
    email: `load-doctor-${index}@example.test`,
    patientCount: 0,
  }));
  const patients = Array.from({ length: 400 }, (_, index) => {
    const doctor = doctors[index % 39]!;
    doctor.patientCount++;
    return {
      ...sample.patients[index % sample.patients.length]!,
      _id: new mongoose.Types.ObjectId((index + 1000).toString(16).padStart(24, "0")),
      doctorId: doctor._id,
      name: `Fictional Load Patient ${index}`,
      email: `load-patient-${index}@example.test`,
    };
  });
  await DoctorModel.insertMany(doctors);
  await PatientModel.insertMany(patients);
  await AdminModel.create({
    name: "Fictional Load Administrator",
    email: "load-admin@example.test",
    passwordHash: await hashPassword("fictional-load-password-only"),
    status: "active",
  });
  const config = parseEnv({
    NODE_ENV: "test",
    MONGODB_URI: uri,
    FRONTEND_ORIGIN: ORIGIN,
    API_RATE_LIMIT: "10000",
    LOGIN_IP_LIMIT: "100",
    LOGIN_ACCOUNT_LIMIT: "5",
  });
  async function listen(ipLimit: number) {
    const server = createHttpServer(
      createRuntimeApp({ ...config, LOGIN_IP_LIMIT: ipLimit }, logger),
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  }
  const first = await listen(100);
  const second = await listen(100);
  const login = await fetch(`${first}/auth/login`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "load-admin@example.test",
      password: "fictional-load-password-only",
    }),
  });
  assert.equal(login.status, 200);
  await login.json();
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie);
  const routes = [
    { name: "doctors/default", path: "/doctors?limit=20", total: 40 },
    { name: "doctors/search", path: "/doctors?search=dr&limit=20", total: 40 },
    { name: "patients/default", path: "/patients?limit=20", total: 400 },
    {
      name: "patients/status",
      path: "/patients?status=follow_up&limit=20",
      total: patients.filter((entry) => entry.status === "follow_up").length,
    },
    {
      name: "patients/doctor",
      path: `/patients?doctorId=${doctors[0]!._id.toHexString()}&limit=20`,
      total: doctors[0]!.patientCount,
    },
    {
      name: "patients/scoped",
      path: `/doctors/${doctors[0]!._id.toHexString()}/patients?limit=20`,
      total: doctors[0]!.patientCount,
    },
    {
      name: "doctors/specialty",
      path: "/doctors?specialization=Cardiology&limit=20",
      total: doctors.filter((entry) => entry.specialization === "Cardiology").length,
    },
    {
      name: "dashboard/30days",
      path: "/dashboard/summary?from=2026-10-13&to=2026-11-12&timezone=Asia%2FDhaka",
      total: null,
    },
  ];
  async function read(index: number) {
    const route = routes[index % routes.length]!;
    const response = await fetch(`${first}${route.path}`, {
      headers: { Origin: ORIGIN, Cookie: cookie! },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    const body: unknown = await response.json();
    if (route.total === null) {
      const { data } = dashboardEnvelope.parse(body);
      assert.equal(data.totals.doctors, 40);
      assert.equal(data.totals.patients, 400);
      assert.equal(
        data.patientsByDate.reduce((sum, point) => sum + point.count, 0),
        data.totals.patientsCreatedInRange,
      );
    } else {
      const result = listEnvelope.parse(body);
      assert.equal(result.meta.total, route.total);
      assert.equal(new Set(result.data.map((entry) => entry.id)).size, result.data.length);
      assert.equal(result.data.length, Math.min(20, route.total));
    }
    return { status: response.status, group: route.name };
  }
  for (let index = 0; index < 16; index++) await read(index);
  const reads = await load(400, 8, read);
  async function failedLogin(target: string, email: string) {
    const response = await fetch(`${target}/auth/login`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "fictional-wrong-password" }),
      signal: AbortSignal.timeout(15000),
    });
    const body: unknown = await response.json();
    const parsed = z.object({ error: z.object({ code: z.string() }) }).parse(body);
    assert([401, 429].includes(response.status));
    assert.equal(
      parsed.error.code,
      response.status === 429 ? "RATE_LIMITED" : "INVALID_CREDENTIALS",
    );
    if (response.status === 429) assert(Number(response.headers.get("retry-after")) > 0);
    return { status: response.status, group: "login/failed-or-throttled" };
  }
  const window = Math.floor(Date.now() / 900000);
  const accountLimit = await load(20, 8, (index) =>
    failedLogin(
      index % 2 ? first : second,
      index % 2 ? "  LIMIT-ACCOUNT@example.test  " : "limit-account@example.test",
    ),
  );
  assert.equal(accountLimit.statuses[401], 5);
  assert.equal(accountLimit.statuses[429], 15);
  // This collection belongs only to the replica set created above. Reset the
  // isolated login counter between independent account/IP experiments.
  assert.equal(mongoose.connection.name, "doctor_tracker_load_fixture");
  await LoginAttemptModel.deleteMany({});
  const ipLimited = await listen(10);
  const ipLimit = await load(20, 8, (index) =>
    failedLogin(ipLimited, `unknown-${index}@example.test`),
  );
  assert.equal(ipLimit.statuses[401], 10);
  assert.equal(ipLimit.statuses[429], 10);
  assert.equal(
    Math.floor(Date.now() / 900000),
    window,
    "The limiter experiment crossed a fixed-window boundary; rerun outside the boundary.",
  );
  assert.equal(
    await SessionModel.countDocuments(),
    1,
    "Failed/throttled sign-ins must not create sessions.",
  );
  const logout = await fetch(`${first}/auth/logout`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: cookie },
  });
  assert.equal(logout.status, 204);
  for (const doctor of doctors)
    assert.equal(doctor.patientCount, await PatientModel.countDocuments({ doctorId: doctor._id }));
  const mongoVersion = z
    .object({ version: z.string() })
    .parse(await mongoose.connection.db!.admin().command({ buildInfo: 1 })).version;
  const report = {
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      availableLogicalCpus: availableParallelism(),
      hostMemoryGiB: Math.round(totalmem() / 1024 ** 3),
      mongoVersion,
      replicaMembers: 1,
      maxPoolSize: 5,
      logging: "silent",
      transport: "loopback HTTP, Node fetch, one process, no TLS/proxy/cold starts",
      fixture: { doctors: 40, patients: 400, administrators: 1, anchor: fixtureDate.toISOString() },
      warmupReads: 16,
    },
    reads,
    accountLimit,
    ipLimit,
    correctness:
      "response bodies, list counts, dashboard series totals, limiter status budgets and final patient counters verified",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ performanceSmoke: "failed", errorType: error instanceof Error ? error.name : "UnknownError", detail: error instanceof assert.AssertionError ? error.message : "Fixture, workload or connection failure" })}\n`,
  );
  process.exitCode = 1;
} finally {
  for (const server of servers) if (server.listening) await closeHttpServer(server);
  await mongoose.disconnect();
  await mongo?.stop();
}
