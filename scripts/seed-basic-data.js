import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "pfm_dts";
const clinicId = process.env.SEED_CLINIC_ID || "clinic_001";

if (!uri) {
  throw new Error("Missing MONGODB_URI. Please set it in .env");
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const now = new Date();

  await db.collection("floors").updateOne(
    { floor_id: "floor1" },
    {
      $set: {
        floor_id: "floor1",
        floor_name: "Floor 1",
        order: 1,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  await db.collection("floors").updateOne(
    { floor_id: "floor2" },
    {
      $set: {
        floor_id: "floor2",
        floor_name: "Floor 2",
        order: 2,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  await db.collection("rooms").updateOne(
    { room_id: "room_x_quang" },
    {
      $set: {
        room_id: "room_x_quang",
        room_name: "Room X Quang",
        floor_id: "floor1",
        order: 1,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  await db.collection("rooms").updateOne(
    { room_id: "room_sieu_am" },
    {
      $set: {
        room_id: "room_sieu_am",
        room_name: "Room Sieu Am",
        floor_id: "floor2",
        order: 1,
        is_active: true,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true }
  );

  const staffSeeds = [
    {
      username: "super_admiin",
      full_name: "Super Admiin",
      role: "super_admin",
      allowed_rooms: ["room_x_quang", "room_sieu_am"],
    },
    {
      username: "staff_receptionist",
      full_name: "Staff Receptionist",
      role: "receptionist",
      allowed_rooms: ["room_x_quang", "room_sieu_am"],
    },
    {
      username: "staff_sieu_am",
      full_name: "Staff Sieu Am",
      role: "nurse",
      allowed_rooms: ["room_sieu_am"],
    },
    {
      username: "staff_x_quang",
      full_name: "Staff X Quang",
      role: "nurse",
      allowed_rooms: ["room_x_quang"],
    },
  ];

  for (const staff of staffSeeds) {
    await db.collection("staff_users").updateOne(
      { username: staff.username, clinic_id: clinicId },
      {
        $set: {
          username: staff.username,
          full_name: staff.full_name,
          role: staff.role,
          clinic_id: clinicId,
          allowed_rooms: staff.allowed_rooms,
          is_active: true,
          updated_at: now,
        },
        $setOnInsert: {
          created_at: now,
          password_hash: "",
        },
      },
      { upsert: true }
    );
  }

  console.log("[seed] floors, rooms, staff_users upserted successfully");
  await client.close();
}

main().catch((error) => {
  console.error("[seed-error]", error);
  process.exit(1);
});
