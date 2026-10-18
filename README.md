# Newtonite Ops — Jira/Miro-style Operations Board

A basic full-stack operational work tracker for the Newtonite Software Engineering Challenge.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL (`pg`)
- Authentication: JWT + bcrypt
- Tests: Node test runner + Supertest

## Features
- Login with seeded demo accounts and self-service registration
- Registration validates name/email/password, hashes passwords with bcrypt, rejects duplicate email addresses, issues an 8-hour JWT, and adds new users to Operations as Members
- Kanban board and searchable/filterable work-item list
- Create and edit work items; assign/claim work; update priority and status
- Workflow enforcement: `Open → In Progress → Awaiting Approval → Resolved → Closed`
- Only Leads/Admins can approve `Awaiting Approval → Resolved`
- Team-scoped access control enforced by the API
- Activity history and comments
- Optimistic concurrency using `version`; stale edits return HTTP 409
- Atomic claim operation; competing claims cannot both succeed
- Idempotency-Key support on item creation
- Server-side filtering and pagination
- PostgreSQL schema initialization and demo seed data

## Requirements
- Node.js 20+ (Node 24 should work)
- PostgreSQL 14+
- A database named `test` (or change `DATABASE_URL`)

## Configure environment files

### 1. Backend
Copy `backend/.env.example` to `backend/.env` and set the database password and JWT secret.

```env
PORT=4000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:55432/test
JWT_SECRET=replace-this-with-a-long-random-secret
FRONTEND_ORIGIN=http://localhost:5173
```

Use the port configured by your PostgreSQL installation. If PostgreSQL listens on the default port, use `5432` instead of `55432`.

**Security:** the database URL belongs only in the backend `.env`. Never put PostgreSQL credentials in a `VITE_*` frontend variable because Vite exposes those values to the browser.

### 2. Frontend
Copy `frontend/.env.example` to `frontend/.env`.

```env
VITE_API_URL=http://localhost:4000/api
```

The frontend environment file contains only the public API base URL, not database credentials.

## Run locally (two terminals)

Terminal 1:
```powershell
cd backend
npm install
npm run dev
```

Terminal 2:
```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

The backend initializes its schema and seed data on startup. The PostgreSQL server must already be running and the target database must exist.

## Accounts and registration
- Use **Create an account** on the login screen to register a new user. New accounts join the `Operations` team with the `Member` role.
- The backend normalizes email addresses to lowercase, validates input, hashes passwords with bcrypt, rejects duplicate email addresses, and returns a JWT after successful registration.
- Existing demo accounts remain available.

## Demo accounts
Password for all demo accounts: `Demo123!`

| Email | Role | Team |
|---|---|---|
| `aaditya@newtonite.dev` | Admin | Operations |
| `lead@newtonite.dev` | Lead | Operations |
| `member@newtonite.dev` | Member | Operations |
| `viewer@newtonite.dev` | Viewer | Operations |
| `engineering@newtonite.dev` | Member | Engineering |

## Tests
```powershell
cd backend
npm test
```
Tests cover workflow rules and API-level validation. For a production submission, add integration tests against an isolated PostgreSQL test database for concurrent claims, stale versions, idempotency, and cross-team authorization.

## Project layout
```text
newtonite-ops/
├── backend/
│   ├── src/
│   │   ├── app.js
│   │   ├── db.js
│   │   ├── server.js
│   │   ├── auth.js
│   │   ├── workflow.js
│   │   └── seed.js
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   ├── .env.example
│   └── package.json
├── ENGINEERING_DECISIONS.md
└── KNOWN_LIMITATIONS.md
```

## Troubleshooting: ECONNREFUSED
If startup reports `ECONNREFUSED`, the app cannot reach PostgreSQL at the host/port in `DATABASE_URL`. Start the PostgreSQL service, verify the port, ensure the database exists, then retry. Example local check:
```powershell
Test-NetConnection localhost -Port 55432
```
If your server uses port 5432, update `DATABASE_URL`. Do not share your real database password publicly.
