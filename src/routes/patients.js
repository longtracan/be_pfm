import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { authMiddleware, requireRole, requireRoomAccess } from "../middleware/auth.js";
import { getDb } from "../lib/mongo.js";
import { createQueueItem } from "../lib/queue-service.js";

const route = new Hono();

route.post(
  "/v1/patients",
  authMiddleware,
  requireRole(["super_admin", "receptionist", "admin", "nurse"]),
  requireRoomAccess("room_id"),
  async (c) => {
    const db = getDb();
    const auth = c.get("auth");
    const body = c.get("requestBody") || {};

    const hisId = String(body.his_id || "").trim();
    const fullName = String(body.full_name || "").trim();
    const dob = String(body.dob || "").trim();
    const roomId = String(body.room_id || "").trim();
    const clinicId = auth.clinic_id;

    if (!hisId || !fullName || !dob || !roomId) {
      return c.json({ ok: false, error: "missing_required_fields" }, 400);
    }

    const now = new Date();
    const patients = db.collection("patients");
    const existing = await patients.findOne({ his_id: hisId, clinic_id: clinicId });

    let patientId;
    if (existing) {
      patientId = existing._id;
      await patients.updateOne(
        { _id: existing._id },
        {
          $set: {
            full_name: fullName,
            dob,
            address: body.address || "",
            is_priority: !!body.is_priority,
            is_online_booking: !!body.is_online_booking,
            updated_at: now,
          },
        }
      );
    } else {
      const inserted = await patients.insertOne({
        his_id: hisId,
        full_name: fullName,
        dob,
        address: body.address || "",
        is_priority: !!body.is_priority,
        is_online_booking: !!body.is_online_booking,
        clinic_id: clinicId,
        created_at: now,
        updated_at: now,
      });
      patientId = inserted.insertedId;
    }

    const queue = await createQueueItem({
      db,
      patientId,
      clinicId,
      roomId,
      isPriority: !!body.is_priority,
      createdBy: auth.user_id,
      note: "created_from_patients_api",
    });

    const qrContent = `pfm://checkin/${String(patientId)}`;
    const qrBase64 = Buffer.from(qrContent).toString("base64");

    return c.json(
      {
        ok: true,
        patient_id: String(patientId),
        queue_id: String(queue._id),
        queue_number: queue.queue_number,
        qr_base64: `data:text/plain;base64,${qrBase64}`,
      },
      201
    );
  }
);

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

  const qrContent = `pfm://checkin/${id}`;
  const qrBase64 = Buffer.from(qrContent).toString("base64");
  return c.json({ ok: true, qr_base64: `data:text/plain;base64,${qrBase64}` });
});

export default route;
