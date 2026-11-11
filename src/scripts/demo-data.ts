import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { createDoctorSchema } from "../modules/doctors/doctor.validation.js";
import { createPatientSchema } from "../modules/patients/patient.validation.js";

const DAY = 86_400_000;
export const DEMO_NAMESPACE = "doctor-tracker-fictional-demo-v1";
export const DEMO_PATIENT_LOADS = [
  28, 24, 22, 19, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 8, 7, 6, 5, 4, 3, 2, 1, 1, 0,
] as const;

function id(kind: string, index: number): Types.ObjectId {
  return new Types.ObjectId(
    createHash("sha256").update(`${DEMO_NAMESPACE}:${kind}:${index}`).digest("hex").slice(0, 24),
  );
}

function randomFor(index: number, field: string): number {
  const digest = createHash("sha256").update(`${DEMO_NAMESPACE}:${index}:${field}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

const clinicians = [
  ["Dr Ayesha Rahman", "Cardiology"],
  ["Dr Farhan Ahmed", "General Medicine"],
  ["Dr Nadia Karim", "Dermatology"],
  ["Dr Samiul Hasan", "Orthopedics"],
  ["Dr Tasnim Chowdhury", "Pediatrics"],
  ["Dr Rafiq Mahmud", "Endocrinology"],
  ["Dr Sabrina Haque", "Neurology"],
  ["Dr Imran Siddiqui", "Gastroenterology"],
  ["Dr Maliha Islam", "Ophthalmology"],
  ["Dr Arman Hossain", "Pulmonology"],
  ["Dr Nusrat Alam", "ENT"],
  ["Dr Tahmid Khan", "Nephrology"],
  ["Dr Samira Das", "Cardiology"],
  ["Dr Adnan Roy", "General Medicine"],
  ["Dr Rukhsana Akter", "Dermatology"],
  ["Dr Mehedi Karim", "Orthopedics"],
  ["Dr Ishrat Sultana", "Pediatrics"],
  ["Dr Faisal Rahman", "Endocrinology"],
  ["Dr Sumaiya Ahmed", "Neurology"],
  ["Dr Zayed Haque", "Gastroenterology"],
  ["Dr Anika Hossain", "Ophthalmology"],
  ["Dr Nabil Chowdhury", "Pulmonology"],
  ["Dr Shaila Mahmud", "ENT"],
  ["Dr Omar Faruque", "Nephrology"],
] as const;

const hospitals = [
  "Crescent Grove Medical Centre",
  "Willowbank Specialist Hospital",
  "Harborview Community Clinic",
  "Northfield Care Centre",
  "Maplebridge Medical Institute",
  "Riverside Grove Hospital",
  "Evergreen Park Clinic",
  "Clearwater Family Health",
] as const;

const conditions: Record<string, readonly string[]> = {
  Cardiology: ["Hypertension review", "Cardiac risk assessment", "Palpitations follow-up"],
  "General Medicine": ["Annual health review", "Seasonal allergy review", "General follow-up"],
  Dermatology: ["Eczema review", "Acne consultation", "Seasonal dermatitis"],
  Orthopedics: ["Knee pain review", "Shoulder mobility review", "Back pain assessment"],
  Pediatrics: ["Routine wellness visit", "Childhood allergy review", "Pediatric asthma review"],
  Endocrinology: ["Thyroid review", "Diabetes follow-up", "Metabolic health review"],
  Neurology: ["Migraine review", "Headache assessment", "Neuropathy follow-up"],
  Gastroenterology: ["Reflux review", "Digestive health review", "Abdominal discomfort assessment"],
  Ophthalmology: ["Vision screening", "Dry eye review", "Routine eye examination"],
  Pulmonology: ["Respiratory review", "Asthma follow-up", "Seasonal cough assessment"],
  ENT: ["Sinus discomfort review", "Hearing assessment", "Allergy review"],
  Nephrology: ["Kidney function review", "Renal health follow-up", "Routine renal assessment"],
};

const firstNames = [
  "Amina",
  "Arif",
  "Mariam",
  "Rashed",
  "Nafisa",
  "Tanvir",
  "Faria",
  "Shafiq",
  "Sadia",
  "Rehan",
  "Mishal",
  "Raihan",
  "Lamia",
  "Saif",
  "Tania",
  "Sajid",
  "Rumana",
  "Abrar",
  "Nabila",
  "Sakib",
  "Priyanka",
  "Sourav",
  "Nishat",
  "Fahim",
  "Sharmeen",
  "Hasib",
  "Ananya",
  "Pranav",
  "Moumita",
  "Ratul",
  "Raisa",
  "Shahriar",
] as const;
const surnames = [
  "Rahman",
  "Islam",
  "Ahmed",
  "Khan",
  "Hossain",
  "Chowdhury",
  "Karim",
  "Alam",
] as const;

/** Synthetic display data only. Reserved .test addresses and 555-01xx numbers are intentional. */
export function buildDemoData(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const doctors = clinicians.map(([name, specialization], index) => ({
    _id: id("doctor", index),
    ...createDoctorSchema.parse({
      name,
      specialization,
      hospital: hospitals[index % hospitals.length],
      phone: `+1 202-555-01${String(index).padStart(2, "0")}`,
      email: `doctor.${String(index + 1).padStart(2, "0")}@doctor-tracker.example.test`,
    }),
    patientCount: 0,
    createdAt: new Date(midnight - (125 + index * 7) * DAY + 4 * 3_600_000),
    updatedAt: new Date(midnight - (125 + index * 7) * DAY + 4 * 3_600_000),
  }));
  let sequence = 0;
  const patients = doctors.flatMap((doctor, doctorIndex) =>
    Array.from({ length: DEMO_PATIENT_LOADS[doctorIndex]! }, () => {
      const index = sequence++;
      const given = firstNames[index % firstNames.length]!;
      const family = surnames[Math.floor(index / firstNames.length) % surnames.length]!;
      const band = randomFor(index, "age-band");
      const daysAgo =
        index < 6
          ? Math.floor(index / 2)
          : band < 0.72
            ? Math.floor(randomFor(index, "created") * 30)
            : band < 0.93
              ? 30 + Math.floor(randomFor(index, "created") * 30)
              : 60 + Math.floor(randomFor(index, "created") * 30);
      const createdAt = new Date(
        Math.min(
          midnight -
            daysAgo * DAY +
            (3 + Math.floor(randomFor(index, "hour") * 8)) * 3_600_000 +
            Math.floor(randomFor(index, "minute") * 60) * 60_000,
          now.getTime() - 60_000,
        ),
      );
      const lastVisitAt = new Date(
        createdAt.getTime() +
          Math.floor(
            randomFor(index, "visited") * Math.max(1, now.getTime() - createdAt.getTime()),
          ),
      );
      const updatedAt = new Date(Math.min(now.getTime(), lastVisitAt.getTime() + 3_600_000));
      const statusRoll = randomFor(index, "status");
      const status = statusRoll < 0.55 ? "active" : statusRoll < 0.85 ? "follow_up" : "discharged";
      const age =
        doctor.specialization === "Pediatrics"
          ? 5 + Math.floor(randomFor(index, "dob") * 12)
          : 19 + Math.floor(randomFor(index, "dob") * 62);
      const birthday = `${now.getUTCFullYear() - age}-${String(1 + Math.floor(randomFor(index, "month") * 12)).padStart(2, "0")}-${String(1 + Math.floor(randomFor(index, "day") * 28)).padStart(2, "0")}`;
      const choices = conditions[doctor.specialization]!;
      const data = createPatientSchema.parse({
        name: `${given} ${family}`,
        condition: choices[Math.floor(randomFor(index, "condition") * choices.length)],
        status,
        ...(index % 7 !== 0
          ? {
              email: `${given.toLowerCase()}.${family.toLowerCase()}.${index + 1}@patients.doctor-tracker.example.test`,
            }
          : {}),
        ...(index % 5 !== 0 || index % 7 === 0
          ? { phone: `+1 202-555-01${String(index % 100).padStart(2, "0")}` }
          : {}),
        dateOfBirth: birthday,
        gender:
          index % 31 === 0
            ? "prefer_not_to_say"
            : index % 29 === 0
              ? "non_binary"
              : index % 2 === 0
                ? "female"
                : "male",
        lastVisitAt: lastVisitAt.toISOString(),
        notes: `Entirely fictional demonstration record; not a real patient. ${status === "follow_up" ? "Follow-up workflow example." : status === "discharged" ? "Completed-care workflow example." : "Active-record workflow example."} Contact details are reserved placeholders.`,
      });
      return {
        _id: id("patient", index),
        doctorId: doctor._id,
        ...data,
        lastVisitAt,
        createdAt,
        updatedAt,
      };
    }),
  );
  return { doctors, patients };
}
