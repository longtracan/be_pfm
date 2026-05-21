import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { getDb } from "../lib/mongo.js";
import {
  buildPatientQrPayload,
  parsePatientPayload,
  upsertPatient,
} from "../lib/queue-service.js";

const route = new Hono();

function serializePatient(patient) {
  if (!patient) return null;
  return {
    id: String(patient._id),
    patient_key: patient.patient_key,
    medical_code: patient.medical_code,
    identity_number: patient.identity_number,
    full_name: patient.full_name,
    dob: patient.dob,
    gender: patient.gender || "",
    address: patient.address || "",
    address_cv30: patient.address_cv30 || "",
    is_priority: !!patient.is_priority,
    is_online_booking: !!patient.is_online_booking,
    created_at: patient.created_at,
    updated_at: patient.updated_at,
  };
}

route.post(
  "/v1/patients",
  authMiddleware,
  requireRole(["super_admin", "admin", "receptionist", "nurse"]),
  async (c) => {
    const db = getDb();
    const body = await c.req.json().catch(() => ({}));
    const parsed = parsePatientPayload(body);

    if (!parsed.medical_code || !parsed.identity_number || !parsed.full_name) {
      return c.json(
        { ok: false, error: "medical_code_identity_number_full_name_required" },
        400
      );
    }

    const patient = await upsertPatient(db, parsed);
    const qrPayload = buildPatientQrPayload(patient);
    const qrContent = JSON.stringify(qrPayload);

    return c.json({
      ok: true,
      patient: serializePatient(patient),
      qr_content: qrContent,
      qr_base64: `data:text/plain;base64,${Buffer.from(qrContent).toString("base64")}`,
      qr_uri: `pfm://checkin/${String(patient._id)}`,
    });
  }
);

route.get("/v1/patients/:id", authMiddleware, async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  if (!ObjectId.isValid(id)) {
    return c.json({ ok: false, error: "invalid_patient_id" }, 400);
  }

  const patient = await db.collection("patients").findOne({ _id: new ObjectId(id) });
  if (!patient) {
    return c.json({ ok: false, error: "patient_not_found" }, 404);
  }

  return c.json({ ok: true, patient: serializePatient(patient) });
});

route.get("/v1/patients/:id/qr", authMiddleware, async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  if (!ObjectId.isValid(id)) {
    return c.json({ ok: false, error: "invalid_patient_id" }, 400);
  }

  const patient = await db.collection("patients").findOne({ _id: new ObjectId(id) });
  if (!patient) {
    return c.json({ ok: false, error: "patient_not_found" }, 404);
  }

  const qrPayload = buildPatientQrPayload(patient);
  const qrContent = JSON.stringify(qrPayload);

  return c.json({
    ok: true,
    patient: serializePatient(patient),
    qr_content: qrContent,
    qr_base64: `data:text/plain;base64,${Buffer.from(qrContent).toString("base64")}`,
    qr_uri: `pfm://checkin/${String(patient._id)}`,
  });
});

export default route;
