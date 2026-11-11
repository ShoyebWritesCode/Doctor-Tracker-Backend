import type { PipelineStage } from "mongoose";
import { DoctorModel, type Doctor } from "../doctors/doctor.model.js";
import { PatientModel } from "../patients/patient.model.js";
import { dashboardRange, type DashboardQuery } from "./dashboard.validation.js";
import type { Types } from "mongoose";

export const DASHBOARD_QUERY_TIMEOUT_MS = 5_000;
export const DOCTOR_RANKING_LIMIT = 10;
export const doctorRankingSort = { patientCount: -1, name: 1, _id: 1 } as const;
export const doctorRankingProjection = { _id: 1, name: 1, patientCount: 1 } as const;
type RankedDoctor = Pick<Doctor, "name" | "patientCount"> & { _id: Types.ObjectId };
type DateCount = { date: string; count: number };

export function patientTrendPipeline(from: Date, to: Date, timezone: string): PipelineStage[] {
  return [
    { $match: { createdAt: { $gte: from, $lt: to } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: "$_id", count: 1 } },
  ];
}

export async function getDashboardSummary(query: DashboardQuery) {
  const range = dashboardRange(query);
  const [doctors, patients, dailyCounts, rankedDoctors] = await Promise.all([
    DoctorModel.countDocuments({}).hint("_id_").maxTimeMS(DASHBOARD_QUERY_TIMEOUT_MS).exec(),
    PatientModel.countDocuments({}).hint("_id_").maxTimeMS(DASHBOARD_QUERY_TIMEOUT_MS).exec(),
    PatientModel.aggregate<DateCount>(patientTrendPipeline(range.from, range.to, query.timezone))
      .option({ maxTimeMS: DASHBOARD_QUERY_TIMEOUT_MS })
      .exec(),
    DoctorModel.find({})
      .select(doctorRankingProjection)
      .sort(doctorRankingSort)
      .limit(DOCTOR_RANKING_LIMIT)
      .maxTimeMS(DASHBOARD_QUERY_TIMEOUT_MS)
      .lean<RankedDoctor[]>()
      .exec(),
  ]);
  const counts = new Map(dailyCounts.map((point) => [point.date, point.count]));
  return {
    range: { from: query.from, to: query.to, timezone: query.timezone },
    totals: {
      doctors,
      patients,
      patientsCreatedInRange: dailyCounts.reduce((total, point) => total + point.count, 0),
      averagePatientsPerDoctor: doctors === 0 ? 0 : Math.round((patients / doctors) * 100) / 100,
    },
    patientsByDate: range.dates.map((date) => ({ date, count: counts.get(date) ?? 0 })),
    patientsByDoctor: rankedDoctors.map((doctor) => ({
      doctorId: doctor._id.toHexString(),
      doctorName: doctor.name,
      count: doctor.patientCount,
    })),
  };
}
