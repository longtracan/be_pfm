import { Hono } from "hono";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { getDb } from "../lib/db.js";
import {
  buildPatientQrPayload,
  parsePatientPayload,
  upsertPatient,
  findPatientById,
} from "../lib/queue-service.js";

const route = new Hono();

// CF Workers has no `Buffer` — use TextEncoder + btoa for base64
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serializePatient(patient) {
  if (!patient) return null;
  return {
    id: patient.id,
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
    const db = getDb(c.env);
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
      qr_base64: `data:text/plain;base64,${toBase64(qrContent)}`,
      qr_uri: `pfm://checkin/${patient.id}`,
    });
  }
);

route.get("/v1/patients/:id", authMiddleware, async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: "invalid_patient_id" }, 400);
  }

  const patient = await findPatientById(db, id);
  if (!patient) {
    return c.json({ ok: false, error: "patient_not_found" }, 404);
  }

  return c.json({ ok: true, patient: serializePatient(patient) });
});

route.get("/v1/patients/:id/qr", authMiddleware, async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: "invalid_patient_id" }, 400);
  }

  const patient = await findPatientById(db, id);
  if (!patient) {
    return c.json({ ok: false, error: "patient_not_found" }, 404);
  }

  const qrPayload = buildPatientQrPayload(patient);
  const qrContent = JSON.stringify(qrPayload);

  return c.json({
    ok: true,
    patient: serializePatient(patient),
    qr_content: qrContent,
    qr_base64: `data:text/plain;base64,${toBase64(qrContent)}`,
    qr_uri: `pfm://checkin/${patient.id}`,
  });
});

export default route;
