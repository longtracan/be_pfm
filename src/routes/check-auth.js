import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { getDb } from "../lib/db.js";

const route = new Hono();

route.get("/check-auth", authMiddleware, async (c) => {
  const auth = c.get("auth");
  // Quick D1 ping to verify DB is reachable
  const db = getDb(c.env);
  await db.prepare("SELECT 1").first();

  return c.json({
    ok: true,
    message: "Authorized request",
    auth,
  });
});

export default route;

