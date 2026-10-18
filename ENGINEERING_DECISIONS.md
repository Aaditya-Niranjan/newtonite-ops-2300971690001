# Engineering Decisions

## 1. Keep the browser separate from database credentials
**Context:** frontend bundles are visible to every user.
**Options:** connect from browser directly to PostgreSQL, or call a backend API.
**Choice:** React talks to Express; only the backend has `DATABASE_URL`.
**Trade-off:** requires an API layer, but credentials and authorization remain server-side.

## 2. PostgreSQL transactions for item changes and history
**Context:** activity history must agree with the current item state.
**Choice:** update the item and append an activity event in one database transaction.
**Trade-off:** transactions add implementation complexity but prevent partial writes.

## 3. Optimistic concurrency
**Context:** users may edit stale copies.
**Choice:** clients send the current `version`; the server updates only when it matches and increments it.
**Trade-off:** a user may need to reload after a conflict, but silent overwrites are avoided.

## 4. Team-scoped role checks
**Context:** hiding buttons is not authorization.
**Choice:** the API verifies membership and role for item reads and writes.
**Trade-off:** membership checks add queries; indexes and centralized helpers keep them maintainable.

## 5. Synchronous core actions, deferred secondary work
**Context:** core work state and history must be reliable.
**Choice:** item mutations and history are synchronous and transactional. A full notification worker is intentionally deferred for this MVP.
**Trade-off:** simpler local setup; asynchronous notifications and retry semantics remain future work.

## 6. Server-side pagination and filtering
**Context:** the challenge expects tens of thousands of items.
**Choice:** the API applies filters and limit/offset pagination in PostgreSQL.
**Trade-off:** offset pagination is simple for a one-day MVP; cursor pagination would be preferable at larger scale.
