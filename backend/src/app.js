import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { requireAuth, membershipFor, requireRole } from "./auth.js";
import { STATUSES, canTransition } from "./workflow.js";

export const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", async (_req,res) => {
  try { await pool.query("SELECT 1"); res.json({ status:"ok", database:"connected" }); }
  catch { res.status(503).json({ status:"error", database:"unavailable" }); }
});
app.post("/api/auth/register", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: "Name must be between 2 and 80 characters" });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  // bcrypt only uses the first 72 bytes of a password. Enforce that limit explicitly.
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 UTF-8 bytes" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1", [email]);
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // New registrations join the default Operations team as a regular Member.
    const teamResult = await client.query(
      "INSERT INTO teams(name) VALUES('Operations') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name",
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await client.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [name, email, passwordHash]
    );
    const user = created.rows[0];
    await client.query(
      "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,'Member') ON CONFLICT(user_id,team_id) DO NOTHING",
      [user.id, teamResult.rows[0].id]
    );
    const memberships = await client.query(
      "SELECT m.team_id,m.role,t.name AS team_name FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=$1",
      [user.id]
    );
    await client.query("COMMIT");

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET || "development-only-secret",
      { expiresIn: "8h" }
    );
    return res.status(201).json({ token, user: { ...user, memberships: memberships.rows } });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.code === "23505") return res.status(409).json({ error: "An account with this email already exists" });
    console.error(e);
    return res.status(500).json({ error: "Registration failed. Please try again." });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req,res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({error:"Email and password are required"});
  try {
    const r = await pool.query("SELECT id,name,email,password_hash FROM users WHERE lower(email)=lower($1)",[email]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:"Invalid email or password"});
    const memberships = await pool.query("SELECT m.team_id,m.role,t.name AS team_name FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=$1",[user.id]);
    const token = jwt.sign({id:user.id,email:user.email,name:user.name}, process.env.JWT_SECRET || "development-only-secret", {expiresIn:"8h"});
    res.json({token,user:{id:user.id,name:user.name,email:user.email,memberships:memberships.rows}});
  } catch(e) { console.error(e); res.status(500).json({error:"Login failed"}); }
});
app.use("/api", requireAuth);
app.get("/api/me", (req,res)=>res.json({user:req.user}));
app.get("/api/teams", (req,res)=>res.json({teams:req.user.memberships}));
app.get("/api/dashboard", async (req,res) => {
  try {
    const ids = req.user.memberships.map(m=>m.team_id);
    if (!ids.length) return res.json({assigned:0,urgent:0,approval:0,total:0});
    const r = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE assignee_id=$1)::int assigned,
      COUNT(*) FILTER (WHERE assignee_id IS NULL AND priority='Urgent' AND status NOT IN ('Resolved','Closed'))::int urgent,
      COUNT(*) FILTER (WHERE status='Awaiting Approval')::int approval,
      COUNT(*)::int total
      FROM work_items WHERE team_id=ANY($2::int[])`,[req.user.id,ids]);
    res.json(r.rows[0]);
  } catch(e) { console.error(e); res.status(500).json({error:"Could not load dashboard"}); }
});
app.get("/api/items", async (req,res) => {
  const { status, priority, assignee, q, team, page="1", limit="50", view } = req.query;
  const allowedTeams = req.user.memberships.map(m=>Number(m.team_id));
  if (!allowedTeams.length) return res.json({items:[],page:1,limit:50,total:0});
  const clauses = ["w.team_id = ANY($1::int[])"];
  const vals = [allowedTeams];
  const add = (sql,v)=>{ vals.push(v); clauses.push(sql.replace("?",`$${vals.length}`)); };
  if (status) add("w.status = ?",status);
  if (priority) add("w.priority = ?",priority);
  if (assignee === "unassigned") clauses.push("w.assignee_id IS NULL");
  else if (assignee === "me") add("w.assignee_id = ?",req.user.id);
  else if (assignee) add("w.assignee_id = ?",Number(assignee));
  if (team && allowedTeams.includes(Number(team))) add("w.team_id = ?",Number(team));
  if (q) { vals.push(`%${String(q).slice(0,100)}%`); clauses.push(`(w.title ILIKE $${vals.length} OR w.description ILIKE $${vals.length} OR w.key ILIKE $${vals.length})`); }
  if (view === "urgent") clauses.push("w.assignee_id IS NULL AND w.priority='Urgent' AND w.status NOT IN ('Resolved','Closed')");
  if (view === "approval") clauses.push("w.status='Awaiting Approval'");
  if (view === "assigned") { vals.push(req.user.id); clauses.push(`w.assignee_id=$${vals.length}`); }
  const pageNum = Math.max(1,parseInt(page,10)||1), limitNum = Math.min(100,Math.max(1,parseInt(limit,10)||50));
  try {
    const where = clauses.join(" AND ");
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM work_items w WHERE ${where}`,vals);
    const listVals = [...vals,limitNum,(pageNum-1)*limitNum];
    const result = await pool.query(`SELECT w.*,t.name AS team_name,u.name AS assignee_name,c.name AS creator_name
      FROM work_items w JOIN teams t ON t.id=w.team_id JOIN users c ON c.id=w.created_by
      LEFT JOIN users u ON u.id=w.assignee_id WHERE ${where}
      ORDER BY CASE w.priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
      w.updated_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,listVals);
    res.json({items:result.rows,page:pageNum,limit:limitNum,total:count.rows[0].total});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not load work items"}); }
});
app.post("/api/items", async (req,res) => {
  const {title,description="",type="Task",priority="Medium",team_id,assignee_id=null,due_date=null} = req.body || {};
  if (!title?.trim()) return res.status(400).json({error:"Title is required"});
  if (!["Incident","Customer Issue","Payment","Compliance","Task"].includes(type)) return res.status(400).json({error:"Invalid item type"});
  if (!["Low","Medium","High","Urgent"].includes(priority)) return res.status(400).json({error:"Invalid priority"});
  const membership = membershipFor(req,team_id);
  if (!requireRole(membership,["Member","Lead","Admin"])) return res.status(403).json({error:"You cannot create items for this team"});
  const idem = req.get("Idempotency-Key");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idem) {
      const old = await client.query("SELECT response FROM idempotency_keys WHERE key=$1 AND user_id=$2",[idem,req.user.id]);
      if (old.rows[0]) { await client.query("COMMIT"); return res.status(200).json(old.rows[0].response); }
    }
    if (assignee_id) {
      const assigneeMembership = await client.query("SELECT 1 FROM memberships WHERE user_id=$1 AND team_id=$2",[assignee_id,team_id]);
      if (!assigneeMembership.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({error:"Assignee must belong to the selected team"}); }
    }
    const seq = await client.query("SELECT nextval(pg_get_serial_sequence('work_items','id')) AS id");
    const id = Number(seq.rows[0].id), key=`OPS-${id}`;
    const inserted = await client.query(`INSERT INTO work_items(id,key,title,description,type,priority,team_id,assignee_id,created_by,due_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id,key,title.trim(),description,type,priority,team_id,assignee_id,req.user.id,due_date||null]);
    const item = inserted.rows[0];
    await client.query("INSERT INTO activity_events(item_id,actor_id,event_type,message) VALUES($1,$2,'created',$3)",[id,req.user.id,`Created ${key}`]);
    if (idem) await client.query("INSERT INTO idempotency_keys(key,user_id,response) VALUES($1,$2,$3::jsonb)",[idem,req.user.id,JSON.stringify(item)]);
    await client.query("COMMIT"); res.status(201).json(item);
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Could not create item"}); }
  finally { client.release(); }
});
async function getAccessibleItem(req,id,client=pool) {
  const r = await client.query("SELECT w.* FROM work_items w WHERE w.id=$1 AND w.team_id=ANY($2::int[])",[id,req.user.memberships.map(m=>Number(m.team_id))]);
  return r.rows[0];
}
app.get("/api/items/:id", async (req,res) => {
  try {
    const item = await getAccessibleItem(req,req.params.id);
    if (!item) return res.status(404).json({error:"Work item not found"});
    const [detail,activity,comments] = await Promise.all([
      pool.query(`SELECT w.*,t.name AS team_name,u.name AS assignee_name,c.name AS creator_name FROM work_items w JOIN teams t ON t.id=w.team_id JOIN users c ON c.id=w.created_by LEFT JOIN users u ON u.id=w.assignee_id WHERE w.id=$1`,[req.params.id]),
      pool.query("SELECT a.*,u.name AS actor_name FROM activity_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.item_id=$1 ORDER BY a.created_at DESC LIMIT 100",[req.params.id]),
      pool.query("SELECT c.*,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.item_id=$1 ORDER BY c.created_at DESC LIMIT 100",[req.params.id])
    ]);
    res.json({item:detail.rows[0],activity:activity.rows,comments:comments.rows});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not load item"}); }
});
app.patch("/api/items/:id", async (req,res) => {
  const {version,title,description,priority,type,due_date,assignee_id} = req.body || {};
  if (!Number.isInteger(Number(version))) return res.status(400).json({error:"Current version is required"});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await getAccessibleItem(req,req.params.id,client);
    if (!current) { await client.query("ROLLBACK"); return res.status(404).json({error:"Work item not found"}); }
    const membership=membershipFor(req,current.team_id);
    if (!requireRole(membership,["Member","Lead","Admin"])) { await client.query("ROLLBACK"); return res.status(403).json({error:"Read-only role"}); }
    if (Number(current.version)!==Number(version)) { await client.query("ROLLBACK"); return res.status(409).json({error:"This item changed. Reload and try again.",current}); }
    if (assignee_id !== undefined && assignee_id !== null) {
      const a=await client.query("SELECT 1 FROM memberships WHERE user_id=$1 AND team_id=$2",[assignee_id,current.team_id]);
      if (!a.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({error:"Assignee must belong to the item's team"}); }
    }
    const fields={title,description,priority,type,due_date,assignee_id};
    const sets=[],vals=[];
    for (const [k,v] of Object.entries(fields)) if (v !== undefined) { vals.push(v === "" && k==="due_date" ? null : v); sets.push(`${k}=$${vals.length}`); }
    if (!sets.length) { await client.query("ROLLBACK"); return res.status(400).json({error:"No fields to update"}); }
    vals.push(req.params.id,version);
    const updated=await client.query(`UPDATE work_items SET ${sets.join(",")},version=version+1,updated_at=NOW() WHERE id=$${vals.length-1} AND version=$${vals.length} RETURNING *`,vals);
    if (!updated.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({error:"This item changed. Reload and try again."}); }
    await client.query("INSERT INTO activity_events(item_id,actor_id,event_type,message) VALUES($1,$2,'updated',$3)",[req.params.id,req.user.id,"Updated work item fields"]);
    await client.query("COMMIT"); res.json(updated.rows[0]);
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Could not update item"}); }
  finally { client.release(); }
});
app.post("/api/items/:id/claim", async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const item=await getAccessibleItem(req,req.params.id,client);
    if (!item) { await client.query("ROLLBACK"); return res.status(404).json({error:"Work item not found"}); }
    const m=membershipFor(req,item.team_id);
    if (!requireRole(m,["Member","Lead","Admin"])) { await client.query("ROLLBACK"); return res.status(403).json({error:"You cannot claim work in this team"}); }
    const r=await client.query("UPDATE work_items SET assignee_id=$1,version=version+1,updated_at=NOW() WHERE id=$2 AND assignee_id IS NULL AND version=$3 RETURNING *",[req.user.id,item.id,item.version]);
    if (!r.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({error:"Someone claimed or changed this item first. Refresh the board."}); }
    await client.query("INSERT INTO activity_events(item_id,actor_id,event_type,message) VALUES($1,$2,'assigned',$3)",[item.id,req.user.id,`Claimed by ${req.user.name}`]);
    await client.query("COMMIT"); res.json(r.rows[0]);
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Could not claim item"}); }
  finally { client.release(); }
});
app.post("/api/items/:id/transition", async (req,res) => {
  const {status,version}=req.body||{};
  if (!STATUSES.includes(status)) return res.status(400).json({error:"Invalid status"});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const item=await getAccessibleItem(req,req.params.id,client);
    if (!item) { await client.query("ROLLBACK"); return res.status(404).json({error:"Work item not found"}); }
    const m=membershipFor(req,item.team_id);
    if (!requireRole(m,["Member","Lead","Admin"])) { await client.query("ROLLBACK"); return res.status(403).json({error:"Read-only role"}); }
    if (Number(item.version)!==Number(version)) { await client.query("ROLLBACK"); return res.status(409).json({error:"Stale item version. Refresh and retry."}); }
    if (!canTransition(item.status,status,m.role)) { await client.query("ROLLBACK"); return res.status(403).json({error:`Transition ${item.status} → ${status} is not allowed for your role`}); }
    const r=await client.query("UPDATE work_items SET status=$1,version=version+1,updated_at=NOW() WHERE id=$2 AND version=$3 RETURNING *",[status,item.id,version]);
    await client.query("INSERT INTO activity_events(item_id,actor_id,event_type,message) VALUES($1,$2,'status_changed',$3)",[item.id,req.user.id,`Status changed: ${item.status} → ${status}`]);
    await client.query("COMMIT"); res.json(r.rows[0]);
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Could not transition item"}); }
  finally { client.release(); }
});
app.post("/api/items/:id/comments", async (req,res) => {
  const body=String(req.body?.body||"").trim();
  if (!body || body.length>2000) return res.status(400).json({error:"Comment must contain 1–2000 characters"});
  try {
    const item=await getAccessibleItem(req,req.params.id);
    if (!item) return res.status(404).json({error:"Work item not found"});
    const c=await pool.query("INSERT INTO comments(item_id,author_id,body) VALUES($1,$2,$3) RETURNING *",[item.id,req.user.id,body]);
    await pool.query("INSERT INTO activity_events(item_id,actor_id,event_type,message) VALUES($1,$2,'commented',$3)",[item.id,req.user.id,"Added a comment"]);
    res.status(201).json({...c.rows[0],author_name:req.user.name});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not add comment"}); }
});
app.get("/api/users", async (req,res) => {
  const teamIds=req.user.memberships.map(m=>m.team_id);
  try {
    const r=await pool.query(`SELECT DISTINCT u.id,u.name,u.email,m.team_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.team_id=ANY($1::int[]) ORDER BY u.name`,[teamIds]);
    res.json({users:r.rows});
  } catch(e) { res.status(500).json({error:"Could not load users"}); }
});
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:"Unexpected server error"}); });
