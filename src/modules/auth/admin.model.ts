import mongoose, { Schema, model, type InferSchemaType, type Model } from "mongoose";

const adminSchema = new Schema(
  {
    email: { required: true, trim: true, lowercase: true, type: String },
    lastLoginAt: { default: null, type: Date },
    name: { maxlength: 100, minlength: 2, required: true, trim: true, type: String },
    passwordHash: { required: true, select: false, type: String },
    status: { default: "active", enum: ["active", "disabled"], required: true, type: String },
  },
  {
    collection: "admins",
    timestamps: true,
    versionKey: false,
  },
);

adminSchema.index({ email: 1 }, { name: "admin_email_unique", unique: true });

export type Admin = InferSchemaType<typeof adminSchema>;
export type AdminModel = Model<Admin>;

export const AdminModel =
  (mongoose.models.Admin as AdminModel | undefined) ?? model<Admin>("Admin", adminSchema);

export type AdminDto = {
  createdAt: string;
  email: string;
  id: string;
  lastLoginAt: string | null;
  name: string;
  status: "active" | "disabled";
  updatedAt: string;
};

export function toAdminDto(admin: Admin & { _id: unknown }): AdminDto {
  return {
    createdAt: admin.createdAt.toISOString(),
    email: admin.email,
    id: String(admin._id),
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    name: admin.name,
    status: admin.status,
    updatedAt: admin.updatedAt.toISOString(),
  };
}
