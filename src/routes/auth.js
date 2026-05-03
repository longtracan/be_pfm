import { Hono } from "hono";
import { getDb } from "../lib/mongo.js";
import { signStaffToken } from "../lib/auth.js";

const route = new Hono();

route.post("/auth/login", async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || "").trim();

  if (!username) {
    return c.json({ ok: false, error: "username_required" }, 400);
  }

  const staff = await db.collection("staff_users").findOne({
    username,
    is_active: true,
  });

  if (!staff) {
    return c.json({ ok: false, error: "staff_not_found" }, 404);
  }

  const token = signStaffToken(staff);
  return c.json({
    ok: true,
    token,
    staff: {
      id: String(staff._id),
      username: staff.username,
      full_name: staff.full_name,
      role: staff.role,
      clinic_id: staff.clinic_id,
      allowed_rooms: staff.allowed_rooms || [],
    },
  });
});

export default route;
