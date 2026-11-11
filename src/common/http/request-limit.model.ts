import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";

const schema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "request_limits", versionKey: false },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "request_limit_expiry_ttl" });
type RequestLimit = InferSchemaType<typeof schema>;
export const RequestLimitModel =
  (mongoose.models.RequestLimit as Model<RequestLimit> | undefined) ??
  model<RequestLimit>("RequestLimit", schema);
