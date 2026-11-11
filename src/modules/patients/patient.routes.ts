import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { authenticate } from "../auth/auth.middleware.js";
import { requireTrustedOrigin } from "../../common/middleware/origin.js";
import { validationError } from "../../common/validation/validation-error.js";
import {
  createPatientSchema,
  updatePatientSchema,
  patientListSchema,
  scopedPatientListSchema,
  patientParamsSchema,
  doctorParamsSchema,
  scopedPatientParamsSchema,
} from "./patient.validation.js";
import {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  deletePatient,
} from "./patient.service.js";

function protectedRouter(config: AppConfig, mergeParams = false): Router {
  const router = Router({ mergeParams });
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.use(authenticate(config));
  router.use(requireTrustedOrigin(config.FRONTEND_ORIGIN, config.NODE_ENV));
  return router;
}

export function createScopedPatientRouter(config: AppConfig): Router {
  const router = protectedRouter(config, true);
  router.get("/", async (request, response) => {
    const params = doctorParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(params.error);
    const query = scopedPatientListSchema.safeParse(request.query);
    if (!query.success) throw validationError(query.error);
    response.json(await listPatients(query.data, params.data.doctorId));
  });
  router.post("/", async (request, response) => {
    const params = doctorParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(params.error);
    const body = createPatientSchema.safeParse(request.body);
    if (!body.success) throw validationError(body.error);
    const patient = await createPatient(params.data.doctorId, body.data);
    response.location(`/api/v1/patients/${patient.id}`).status(201).json({ data: patient });
  });
  router.delete("/:patientId", async (request, response) => {
    const params = scopedPatientParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(params.error);
    await deletePatient(params.data.patientId, params.data.doctorId);
    response.status(204).end();
  });
  return router;
}

export function createPatientRouter(config: AppConfig): Router {
  const router = protectedRouter(config);
  router.get("/", async (request, response) => {
    const query = patientListSchema.safeParse(request.query);
    if (!query.success) throw validationError(query.error);
    response.json(await listPatients(query.data));
  });
  router.get("/:patientId", async (request, response) => {
    const params = patientParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(params.error);
    response.json({ data: await getPatient(params.data.patientId) });
  });
  router.patch("/:patientId", async (request, response) => {
    const params = patientParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(params.error);
    const body = updatePatientSchema.safeParse(request.body);
    if (!body.success) throw validationError(body.error);
    response.json({ data: await updatePatient(params.data.patientId, body.data) });
  });
  router.delete("/:patientId", async (request, response) => {
    const params = patientParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(params.error);
    await deletePatient(params.data.patientId);
    response.status(204).end();
  });
  return router;
}
