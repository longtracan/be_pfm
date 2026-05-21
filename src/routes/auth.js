import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../lib/mongo.js";
import { signStaffToken, verifyToken } from "../lib/auth.js";

const route = new Hono();

route.get("/auth/users", async (c) => {
  const db = getDb();
  const staffUsers = await db
    .collection("staff_users")
    .find({ is_active: true })
    .sort({ username: 1 })
    .project({
      username: 1,
      full_name: 1,
      role: 1,
      allowed_rooms: 1,
    })
    .toArray();

  return c.json({
    ok: true,
    items: staffUsers.map((staff) => ({
      id: String(staff._id),
      username: staff.username,
      full_name: staff.full_name,
      role: staff.role,
      allowed_rooms: staff.allowed_rooms || [],
    })),
  });
});

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
      allowed_rooms: staff.allowed_rooms || [],
    },
  });
});

route.post("/auth/refresh-token", async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || "").trim();

  if (!token) {
    return c.json({ ok: false, error: "token_required" }, 400);
  }

  try {
    const decoded = verifyToken(token);
    const staffId = decoded.user_id;

    const staff = await db.collection("staff_users").findOne({
      _id: new ObjectId(staffId),
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
