import dotenv from "dotenv";
dotenv.config();
import bcrypt from "bcryptjs";
import { pool, initDb } from "./db.js";
async function seed() {
  await initDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const teams = {};
    for (const name of ["Operations", "Engineering", "Finance"]) {
      const r = await client.query("INSERT INTO teams(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id", [name]);
      teams[name] = r.rows[0].id;
    }
    const demoUsers = [
      ["Aaditya Niranjan","aaditya@newtonite.dev","Admin","Operations"],
      ["Olivia Lead","lead@newtonite.dev","Lead","Operations"],
      ["Morgan Member","member@newtonite.dev","Member","Operations"],
      ["Taylor Viewer","viewer@newtonite.dev","Viewer","Operations"],
      ["Evan Engineer","engineering@newtonite.dev","Member","Engineering"],
      ["Finley Lead","financelead@newtonite.dev","Lead","Finance"]
    ];
    const ids = {};
    for (const [name,email,role,team] of demoUsers) {
      const hash = await bcrypt.hash("Demo123!", 10);
      const u = await client.query(
        `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)
         ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [name,email,hash]
      );
      ids[email] = u.rows[0].id;
      await client.query(`INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,$3) ON CONFLICT(user_id,team_id) DO UPDATE SET role=EXCLUDED.role`,
        [ids[email], teams[team], role]);
    }
    const count = await client.query("SELECT COUNT(*)::int AS n FROM work_items");
    if (count.rows[0].n === 0) {
      const examples = [
        ["Investigate delayed payment","Payment gateway settlement is delayed; reconcile the last batch.","Payment","Urgent","Open","Operations","member@newtonite.dev"],
        ["Customer cannot access account","Review authentication logs and contact the customer.","Customer Issue","High","In Progress","Operations","lead@newtonite.dev"],
        ["Review production alert","Investigate elevated API latency.","Incident","High","Awaiting Approval","Engineering","engineering@newtonite.dev"],
        ["Quarterly access review","Confirm access permissions for finance tools.","Compliance","Medium","Open","Finance","financelead@newtonite.dev"],
        ["Update onboarding checklist","Refresh operational onboarding steps.","Task","Low","Resolved","Operations","aaditya@newtonite.dev"]
      ];
      for (let i=0;i<examples.length;i++) {
        const [title,description,type,priority,status,team,assignee] = examples[i];
        const r = await client.query(
          `INSERT INTO work_items(key,title,description,type,priority,status,team_id,assignee_id,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [`OPS-${i+1}`,title,description,type,priority,status,teams[team],ids[assignee],ids["aaditya@newtonite.dev"]]
        );
        await client.query("INSERT INTO activity_events(item_id,actor_id,event_type,message) VALUES($1,$2,'created','Work item created')",
          [r.rows[0].id, ids["aaditya@newtonite.dev"]]);
      }
    }
    await client.query("COMMIT");
    console.log("Seed complete. Demo password: Demo123!");
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); await pool.end(); }
}
seed().catch(e=>{console.error(e);process.exit(1)});
