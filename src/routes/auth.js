import { Hono } from "hono";
import { getDb } from "../lib/mongo.js";
import { signStaffToken } from "../lib/auth.js";

const route = new Hono();

// Login route for staff users
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

// Get refresh token
route.post("/auth/refresh-token", async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || "").trim();

  if (!token) {
    return c.json({ ok: false, error: "token_required" }, 400);
  }

  try {
    const decoded = await signStaffToken.verify(token);
    const staffId = decoded.staff_id;

    const staff = await db.collection("staff_users").findOne({
      _id: new db.bson.ObjectId(staffId),
      is_active: true,
    });

    if (!staff) {
      return c.json({ ok: false, error: "staff_not_found" }, 404);
    }

    const newToken = signStaffToken(staff);
    return c.json({
      ok: true,
      token: newToken,
    });
  } catch (error) {
    return c.json({ ok: false, error: "invalid_token" }, 401);
  }
});

export default route;
