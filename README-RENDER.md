# ARcodm Subscription 3.0 — Render Docker build

This version intentionally uses a pinned Node 20 Docker image. It does NOT depend on Render's native Node/npm setup, so errors such as `npm: command not found` or Corepack `EACCES` are avoided.

## Recommended Render setup

### Option A — Blueprint (recommended)
Use the `render.yaml` in the repository root. It creates:
- a Docker Web Service
- a Render Postgres database
- `DATABASE_URL` wired automatically to the database

Set `PUBLIC_BASE_URL` after the service gets its `onrender.com` URL.
Example:
`https://your-service.onrender.com`

Leave `ADMIN_KEY` empty unless you have a separate client that sends `x-admin-key` on DELETE requests.

### Option B — Existing Web Service
Change the service runtime to **Docker** and make sure the repository root contains:
- Dockerfile
- package.json
- server.js

Do not use `corepack enable`.
Do not use a Node build command. The Dockerfile installs dependencies itself.
If the Dashboard asks for commands, they are not used by Docker builds.

For durable subscriptions, create a Render Postgres database and set:
`DATABASE_URL=<Postgres internal connection string>`

`PUBLIC_BASE_URL` must be the public URL of this service.

## Health check
Open:
`https://YOUR-SERVICE.onrender.com/health`

With PostgreSQL connected it should return JSON containing:
- `"ok": true`
- `"storage": "postgres"`
- `"version": "3.0.0"`

If it says `storage: file`, the service is running but PostgreSQL is not connected. Free Render web-service filesystems are ephemeral, so use Postgres for persistent subscriptions.

## Timer behavior
Updating an active subscription keeps its original expiration time. A new timer is created only when the subscription is new or already expired.


Fix 3.2: corrected the /sub/:id page renderer call (req, subscription, id) and added Render external URL fallback; server explicitly binds to 0.0.0.0.
