import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "pfm_dts";

if (!uri) {
  throw new Error("Missing MONGODB_URI. Please set it in .env");
}

async function createCollectionIfNeeded(db, name) {
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    await db.createCollection(name);
    console.log(`[init-db] created collection: ${name}`);
  } else {
    console.log(`[init-db] collection already exists: ${name}`);
  }
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  await createCollectionIfNeeded(db, "patients");
  await createCollectionIfNeeded(db, "queues");
  await createCollectionIfNeeded(db, "devices");
  await createCollectionIfNeeded(db, "staff_users");
  await createCollectionIfNeeded(db, "floors");
  await createCollectionIfNeeded(db, "rooms");
  await createCollectionIfNeeded(db, "counters");

  await db.collection("patients").createIndexes([
    { key: { his_id: 1, clinic_id: 1 }, unique: true, name: "uq_his_id_clinic_id" },
    { key: { created_at: -1 }, name: "idx_patients_created_at_desc" },
  ]);

  await db.collection("queues").createIndexes([
    {
      key: { "location.id": 1, status: 1, order: 1 },
      name: "idx_queues_location_status_order",
    },
    { key: { patient_id: 1 }, name: "idx_queues_patient_id" },
    { key: { created_at: -1 }, name: "idx_queues_created_at_desc" },
    { key: { clinic_id: 1, created_at: -1 }, name: "idx_queues_clinic_created_at_desc" },
  ]);

  await db.collection("devices").createIndexes([
    { key: { binding_id: 1 }, name: "idx_devices_binding_id" },
    {
      key: { pairing_code: 1 },
      sparse: true,
      name: "idx_devices_pairing_code_sparse",
    },
    { key: { last_heartbeat: -1 }, name: "idx_devices_last_heartbeat_desc" },
  ]);

  await db.collection("staff_users").createIndexes([
    { key: { username: 1, clinic_id: 1 }, unique: true, name: "uq_staff_username_clinic_id" },
    { key: { clinic_id: 1, role: 1 }, name: "idx_staff_clinic_role" },
    { key: { is_active: 1 }, name: "idx_staff_active" },
  ]);

  await db.collection("floors").createIndexes([
    { key: { floor_id: 1 }, unique: true, name: "uq_floor_id" },
    { key: { is_active: 1, order: 1 }, name: "idx_floors_active_order" },
  ]);

  await db.collection("rooms").createIndexes([
    { key: { room_id: 1 }, unique: true, name: "uq_room_id" },
    { key: { floor_id: 1, order: 1 }, name: "idx_rooms_floor_order" },
    { key: { is_active: 1 }, name: "idx_rooms_active" },
  ]);

  await db.collection("counters").createIndexes([
    {
      key: { clinic_id: 1, date_key: 1, type: 1 },
      unique: true,
      name: "uq_counters_clinic_date_type",
    },
  ]);

  console.log(`[init-db] done for db: ${db.databaseName}`);
  await client.close();
}

main().catch((error) => {
  console.error("[init-db-error]", error);
  process.exit(1);
});
