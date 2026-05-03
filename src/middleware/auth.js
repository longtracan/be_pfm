import { verifyToken } from "../lib/auth.js";

export async function authMiddleware(c, next) {
  const header = c.req.header("authorization");

  if (!header || !header.startsWith("Bearer ")) {
    return c.json(
      { ok: false, error: "missing_or_invalid_authorization_header" },
      401
    );
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const payload = verifyToken(token);
    c.set("auth", payload);
    await next();
  } catch (error) {
    return c.json({ ok: false, error: "invalid_or_expired_token" }, 401);
  }
}

export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth || !allowed.includes(auth.role)) {
      return c.json({ ok: false, error: "forbidden_role" }, 403);
    }
    await next();
  };
}

export function requireRoomAccess(roomField = "room_id") {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ ok: false, error: "unauthorized" }, 401);

    if (auth.role === "super_admin") {
      await next();
      return;
    }

    const body = c.req.method === "GET" ? {} : await c.req.json().catch(() => ({}));
    const roomId = c.req.query(roomField) || body[roomField];
    if (!roomId) {
      return c.json({ ok: false, error: "room_id_required" }, 400);
    }

    const allowedRooms = auth.allowed_rooms || [];
    if (!allowedRooms.includes(roomId)) {
      return c.json({ ok: false, error: "forbidden_room_access" }, 403);
    }
    c.set("requestBody", body);
    await next();
  };
}
