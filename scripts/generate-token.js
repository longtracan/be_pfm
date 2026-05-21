import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const secret = process.env.JWT_SECRET || "pfm_dev_secret_change_me";

const token = jwt.sign(
  {
    user_id: "staff_001",
    username: "staff_001",
    role: "admin",
    allowed_rooms: ["room_sieu_am", "room_noi"],
  },
  secret,
  { expiresIn: "8h" }
);

console.log(token);
