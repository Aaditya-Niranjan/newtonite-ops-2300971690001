import dotenv from "dotenv";
dotenv.config();
import { app } from "./app.js";
import { initDb, pool } from "./db.js";
const port=Number(process.env.PORT||4000);
try {
  await initDb();
  app.listen(port,()=>console.log(`Newtonite Ops API listening on http://localhost:${port}`));
} catch(e) {
  console.error("Could not initialize database. Check DATABASE_URL, PostgreSQL service, port and database name.");
  console.error(e.message);
  await pool.end();
  process.exit(1);
}
