# ARcodm Subscription 3.3

## What this version fixes
- Subscription HTML is sent with `no-store` cache headers, so a phone cannot keep showing an old timer such as 27 days for a newly-created 30-day subscription.
- Deleting a config no longer deletes/recreates the subscription when other configs remain; the backend updates the same subscription and preserves its original expiry time.
- Deleting the final config disables the subscription on the server.
- The DELETE endpoint is a bearer-style action protected by the random subscription ID; the old `ADMIN_KEY` middleware was removed because the static panel cannot safely know an admin secret.
- Render startup explicitly uses `0.0.0.0`.
- PostgreSQL is preferred for persistence.

## Important Render persistence requirement
If `DATABASE_URL` is missing, the app falls back to `/var/data/subscriptions.json`. Render Free web services have an ephemeral filesystem, so that fallback can be lost when the service spins down/restarts.

Use Render Postgres and make sure the service has a `DATABASE_URL` environment variable. The included `render.yaml` defines a Render Postgres database and wires its connection string into the web service.

## Deploy
1. Replace the backend files in your GitHub repo with this folder.
2. Deploy/redeploy `arcodm-subscription` on Render.
3. Open `/health` and verify `"storage":"postgres"`.
4. If it says `"storage":"file"`, configure `DATABASE_URL` before relying on the service.
5. Replace your panel HTML with the included `AR.html`.

Note: Render Free Postgres currently expires after 30 days. For data that must survive beyond that, use a paid datastore/plan.
