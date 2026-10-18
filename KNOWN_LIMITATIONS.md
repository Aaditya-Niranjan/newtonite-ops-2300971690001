# Known Limitations

- The MVP has seeded demo users rather than self-service registration or password reset.
- The initial UI focuses on one workspace and a Kanban workflow; it is not a full Miro whiteboard.
- No email notifications, attachments, SSO, websockets, or background worker.
- Pagination uses limit/offset, which can become slower for deep pages.
- Demo accounts share a known password; change these credentials before deployment.
- Integration tests against PostgreSQL should be added for concurrent claims, idempotency, stale updates, and team isolation before submission.
- Configure HTTPS, rate limiting, secure deployment secrets, audit retention, and production-grade observability before production use.
