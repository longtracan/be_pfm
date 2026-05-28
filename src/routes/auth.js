import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { signStaffToken, verifyToken } from "../lib/auth.js";

const route = new Hono();

route.get("/auth/users", async (c) => {
  const db = getDb(c.env);
  const { results: staffUsers } = await db
    .prepare("SELECT id, username, full_name, role, allowed_rooms FROM staff_users WHERE is_active = 1 ORDER BY username ASC")
    .all();

  return c.json({
    ok: true,
    items: staffUsers.map((staff) => ({
      id: staff.id,
      username: staff.username,
      full_name: staff.full_name,
      role: staff.role,
      allowed_rooms: JSON.parse(staff.allowed_rooms || "[]"),
    })),
  });
});

route.post("/auth/login", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  if (!username) {
    return c.json({ ok: false, error: "username_required" }, 400);
  }

  const staff = await db
    .prepare("SELECT * FROM staff_users WHERE username = ? AND is_active = 1 LIMIT 1")
    .bind(username)
    .first();

  if (!staff) {
    return c.json({ ok: false, error: "staff_not_found" }, 404);
  }

  const parsedStaff = { ...staff, allowed_rooms: JSON.parse(staff.allowed_rooms || "[]") };
  const token = await signStaffToken(parsedStaff, c.env);
  return c.json({
    ok: true,
    token,
    staff: {
      id: staff.id,
      username: staff.username,
      full_name: staff.full_name,
      role: staff.role,
      allowed_rooms: parsedStaff.allowed_rooms,
    },
  });
});

route.post("/auth/refresh-token", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || "").trim();

  if (!token) {
    return c.json({ ok: false, error: "token_required" }, 400);
  }

  try {
    const decoded = await verifyToken(token, c.env);
    const staffId = decoded.user_id;

    const staff = await db
      .prepare("SELECT * FROM staff_users WHERE id = ? AND is_active = 1 LIMIT 1")
      .bind(staffId)
      .first();

    if (!staff) {
      return c.json({ ok: false, error: "staff_not_found" }, 404);
    }

    const parsedStaff = { ...staff, allowed_rooms: JSON.parse(staff.allowed_rooms || "[]") };
    const newToken = await signStaffToken(parsedStaff, c.env);
    return c.json({
      ok: true,
      token: newToken,
    });
  } catch {
    return c.json({ ok: false, error: "invalid_token" }, 401);
  }
});

export default route;
