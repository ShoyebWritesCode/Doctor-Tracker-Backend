import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { requireTrustedOrigin } from "../../common/middleware/origin.js";
import { validationError } from "../../common/validation/validation-error.js";
import { authenticate } from "../auth/auth.middleware.js";
import { createDoctorSchema, doctorIdSchema, doctorListSchema } from "./doctor.validation.js";
import { createDoctor, getDoctor, listDoctors } from "./doctor.service.js";

export function createDoctorRouter(config: AppConfig): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.use(authenticate(config));
  router.use(requireTrustedOrigin(config.FRONTEND_ORIGIN, config.NODE_ENV));
  router.post("/", async (request, response) => {
    const parsed = createDoctorSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const doctor = await createDoctor(parsed.data);
    response.location(`/api/v1/doctors/${doctor.id}`).status(201).json({ data: doctor });
  });
  router.get("/", async (request, response) => {
    const parsed = doctorListSchema.safeParse(request.query);
    if (!parsed.success) throw validationError(parsed.error);
    response.status(200).json(await listDoctors(parsed.data));
  });
  router.get("/:doctorId", async (request, response) => {
    const parsed = doctorIdSchema.safeParse(request.params.doctorId);
    if (!parsed.success) throw validationError(parsed.error);
    response.status(200).json({ data: await getDoctor(parsed.data) });
  });
  return router;
}
