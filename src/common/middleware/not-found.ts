import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const notFound: RequestHandler = (_request, _response, next) => {
  next(
    new AppError({
      code: "ROUTE_NOT_FOUND",
      message: "The requested API route does not exist.",
      statusCode: 404,
    }),
  );
};
