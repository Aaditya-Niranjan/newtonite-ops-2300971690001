import pg from "pg";
import dotenv from "dotenv";
dotenv.config();
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS memberships (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('Viewer','Member','Lead','Admin')),
      PRIMARY KEY(user_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS work_items (
      id BIGSERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL,
      title VARCHAR(180) NOT NULL, description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'Task' CHECK (type IN ('Incident','Customer Issue','Payment','Compliance','Task')),
      priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Urgent')),
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Awaiting Approval','Resolved','Closed')),
      team_id INTEGER NOT NULL REFERENCES teams(id), assignee_id INTEGER REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id), due_date DATE,
      version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_events (
      id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id), event_type TEXT NOT NULL, message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_items_team_status_updated ON work_items(team_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_assignee ON work_items(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_items_priority ON work_items(priority);
    CREATE INDEX IF NOT EXISTS idx_activity_item_created ON activity_events(item_id, created_at DESC);
  `);
}
