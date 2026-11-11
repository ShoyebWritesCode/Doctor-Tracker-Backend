import type { RequestHandler } from "express";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";
import { AdminModel, toAdminDto } from "./admin.model.js";
import { readCookie } from "./cookie.js";
import { SessionModel } from "./session.model.js";
import { hashSessionToken } from "./session-token.js";

const authenticationRequired = () =>
  new AppError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
    statusCode: 401,
  });

export function authenticate(config: AppConfig): RequestHandler {
  return async (request, _response, next) => {
    try {
      const token = readCookie(request.get("Cookie"), config.SESSION_COOKIE_NAME);
      if (!token) {
        next(authenticationRequired());
        return;
      }

      const session = await SessionModel.findOne({
        expiresAt: { $gt: new Date() },
        tokenHash: hashSessionToken(token),
      }).exec();
      if (!session) {
        next(authenticationRequired());
        return;
      }

      const admin = await AdminModel.findOne({ _id: session.adminId, status: "active" }).exec();
      if (!admin) {
        await SessionModel.deleteOne({ _id: session._id }).exec();
        next(authenticationRequired());
        return;
      }

      request.auth = { admin: toAdminDto(admin), sessionId: String(session._id) };
      next();
    } catch (error) {
      next(error);
    }
  };
}
