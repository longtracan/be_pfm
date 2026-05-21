import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "pfm_dev_secret_change_me";

export function signStaffToken(staffUser) {
  return jwt.sign(
    {
      user_id: String(staffUser._id),
      username: staffUser.username,
      role: staffUser.role,
      allowed_rooms: staffUser.allowed_rooms || [],
      full_name: staffUser.full_name,
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
