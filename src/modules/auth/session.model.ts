import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";

const sessionSchema = new Schema(
  {
    adminId: { index: false, ref: "Admin", required: true, type: Schema.Types.ObjectId },
    expiresAt: { required: true, type: Date },
    tokenHash: { required: true, select: false, type: String },
    userAgent: { maxlength: 300, type: String },
  },
  {
    collection: "sessions",
    timestamps: true,
    versionKey: false,
  },
);

sessionSchema.index({ tokenHash: 1 }, { name: "session_token_hash_unique", unique: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "session_expiry_ttl" });
sessionSchema.index({ adminId: 1 }, { name: "session_admin" });

export type Session = InferSchemaType<typeof sessionSchema>;
export type SessionModel = Model<Session>;

export const SessionModel =
  (mongoose.models.Session as SessionModel | undefined) ?? model<Session>("Session", sessionSchema);
