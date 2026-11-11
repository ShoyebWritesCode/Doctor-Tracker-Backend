import { mongo, type QueryFilter, type SortOrder } from "mongoose";
import { AppError } from "../../common/errors/app-error.js";
import { DoctorModel, doctorProjection, toDoctorDto, type Doctor } from "./doctor.model.js";
import {
  escapeSearch,
  normalizeDoctorText,
  type CreateDoctorInput,
  type DoctorListQuery,
} from "./doctor.validation.js";

export async function createDoctor(input: CreateDoctorInput) {
  try {
    const doctor = await DoctorModel.create(input);
    return toDoctorDto(doctor);
  } catch (error) {
    if (error instanceof mongo.MongoServerError && error.code === 11000) {
      throw new AppError({
        code: "DOCTOR_EMAIL_CONFLICT",
        message: "A doctor with this email already exists.",
        statusCode: 409,
      });
    }
    throw error;
  }
}

export function buildDoctorFilter(query: DoctorListQuery): QueryFilter<Doctor> {
  const filter: QueryFilter<Doctor> = {};
  if (query.specialization)
    filter.specializationNormalized = normalizeDoctorText(query.specialization);
  if (query.hospital) filter.hospitalNormalized = normalizeDoctorText(query.hospital);
  if (query.createdFrom || query.createdTo) {
    filter.createdAt = {
      ...(query.createdFrom ? { $gte: new Date(query.createdFrom) } : {}),
      ...(query.createdTo ? { $lt: new Date(query.createdTo) } : {}),
    };
  }
  if (query.search) {
    const prefix = new RegExp(`^${escapeSearch(normalizeDoctorText(query.search))}`);
    filter.$or = [{ nameNormalized: prefix }, { email: prefix }, { hospitalNormalized: prefix }];
  }
  return filter;
}

export function buildDoctorSort(query: DoctorListQuery): Record<string, SortOrder> {
  const direction = query.sort.endsWith(":asc") ? 1 : -1;
  return {
    [query.sort.startsWith("name:") ? "nameNormalized" : "createdAt"]: direction,
    _id: direction,
  };
}

export async function listDoctors(query: DoctorListQuery) {
  const filter = buildDoctorFilter(query);
  const count = DoctorModel.countDocuments(filter);
  // Empty-filter exact counts otherwise scan documents; reuse the existing ID
  // index. Filtered counts retain the planner's selective-index choice.
  if (Object.keys(filter).length === 0) count.hint("_id_");
  const [doctors, total] = await Promise.all([
    DoctorModel.find(filter)
      .select(doctorProjection)
      .sort(buildDoctorSort(query))
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean()
      .exec(),
    count.exec(),
  ]);
  return {
    data: doctors.map(toDoctorDto),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getDoctor(id: string) {
  const doctor = await DoctorModel.findById(id).select(doctorProjection).lean().exec();
  if (!doctor)
    throw new AppError({
      code: "DOCTOR_NOT_FOUND",
      message: "The requested doctor does not exist.",
      statusCode: 404,
    });
  return toDoctorDto(doctor);
}
