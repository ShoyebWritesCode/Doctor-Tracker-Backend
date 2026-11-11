import type { AdminDto } from "../modules/auth/admin.model.js";
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      auth?: {
        admin: AdminDto;
        sessionId: string;
      };
    }
    interface Response {
      log: Logger;
    }
  }
}

export {};
