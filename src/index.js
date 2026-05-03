import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import dotenv from "dotenv";
import checkDbRoute from "./routes/check-db.js";
import checkAuthRoute from "./routes/check-auth.js";
import authRoute from "./routes/auth.js";
import modulesRoute from "./routes/modules.js";
import patientsRoute from "./routes/patients.js";
import queueRoute from "./routes/queue.js";
import { connectMongo, closeMongo } from "./lib/mongo.js";

dotenv.config();

const app = new Hono();
app.use("*", logger());

app.get("/", (c) =>
  c.json({
    service: "pfm-backend",
    status: "ok",
    env: process.env.NODE_ENV || "development",
  })
);

app.route("/api", checkDbRoute);
app.route("/api", checkAuthRoute);
app.route("/api", authRoute);
app.route("/api", modulesRoute);
app.route("/api", patientsRoute);
app.route("/api", queueRoute);

const port = Number(process.env.PORT || 3000);

async function bootstrap() {
  await connectMongo();

  serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      console.log(`[pfm-backend] running on http://localhost:${port}`);
    }
  );
}

bootstrap().catch((error) => {
  console.error("[bootstrap-error]", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await closeMongo();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeMongo();
  process.exit(0);
});
