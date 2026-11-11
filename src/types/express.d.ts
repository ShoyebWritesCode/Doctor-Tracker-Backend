import type { AdminDto } from "../modules/auth/admin.model.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        admin: AdminDto;
        sessionId: string;
      };
    }
  }
}

export {};
