import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";

const loginAttemptSchema = new Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: "login_attempts", versionKey: false },
);

loginAttemptSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "login_attempt_expiry_ttl" },
);

type LoginAttempt = InferSchemaType<typeof loginAttemptSchema>;
export const LoginAttemptModel =
  (mongoose.models.LoginAttempt as Model<LoginAttempt> | undefined) ??
  model<LoginAttempt>("LoginAttempt", loginAttemptSchema);
