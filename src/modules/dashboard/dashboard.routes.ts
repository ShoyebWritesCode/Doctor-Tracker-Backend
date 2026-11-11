import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { validationError } from "../../common/validation/validation-error.js";
import { authenticate } from "../auth/auth.middleware.js";
import { dashboardQuerySchema } from "./dashboard.validation.js";
import { getDashboardSummary } from "./dashboard.service.js";

export function createDashboardRouter(config: AppConfig): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.use(authenticate(config));
  router.get("/summary", async (request, response) => {
    const query = dashboardQuerySchema.safeParse(request.query);
    if (!query.success) throw validationError(query.error);
    response.json({ data: await getDashboardSummary(query.data) });
  });
  return router;
}
