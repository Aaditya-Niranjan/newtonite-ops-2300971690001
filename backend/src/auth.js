import jwt from "jsonwebtoken";
import { pool } from "./db.js";
export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "development-only-secret");
    const result = await pool.query(
      `SELECT m.team_id, m.role, t.name AS team_name FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=$1`,
      [payload.id]
    );
    req.user = { id: payload.id, email: payload.email, name: payload.name, memberships: result.rows };
    next();
  } catch (err) { return res.status(401).json({ error: "Invalid or expired token" }); }
}
export function membershipFor(req, teamId) {
  return req.user?.memberships.find(m => Number(m.team_id) === Number(teamId));
}
export function requireRole(membership, roles) {
  return Boolean(membership && roles.includes(membership.role));
}
