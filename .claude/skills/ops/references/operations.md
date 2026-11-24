# Operations

Read this before touching a running environment: logs, restarts, rollbacks, backups, restores.

Connect as the deploy user and work from the host folder (see
`.claude/skills/ops/references/environments.md`). Every command below is run there and uses
`docker compose -f compose.prod.yaml`, shortened to `dc`.

## Everyday

| Task                    | Command                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| What is running         | `dc ps`                                                                                             |
| Logs of one service     | `dc logs --tail 200 api` (or `web`, `caddy`, `postgres`, `migrate`)                                 |
| Restart one service     | `dc restart api`                                                                                    |
| Apply a changed `.env`  | `dc up -d` (recreates the containers whose settings changed)                                        |
| Health from outside     | `curl https://<api-domain>/health`                                                                  |
| Whole flow from outside | `bash scripts/smoke.sh https://<api-domain> https://<web-domain>` (creates one gift and deletes it) |

Things worth grepping in the API log: `REFUND DUE` (a payment that could not be delivered and
must be refunded by hand in Stripe), `No order for Stripe session` (a webhook for something that
is not ours).

## Roll back

Images are kept in GHCR under their tag. Set `IMAGE_TAG` in the host `.env` to the previous tag
(`main-<commit>` in staging, the previous version in production), then `dc pull && dc up -d`.
Migrations are not rolled back: a release that changed the schema needs a forward fix unless the
old code tolerates the new schema.

## Backups

`scripts/backup.sh` is copied to the host on every deploy and scheduled with cron. It dumps the
database with `pg_dump` through the `postgres` container, gzips it into `backups/`, gives the file
its final name only when the dump completed, and deletes dumps older than `KEEP_DAYS` (default in
the script). Media is in R2 and is not included.

- Check it ran: `tail backup.log` and `ls -la backups/`.
- Run it now: `bash backup.sh`.
- The dumps stay on the same host. Copying them elsewhere is not set up yet.

## Restore

Restoring over the live database destroys what is there: get the owner's go-ahead first.

1. Prove the dump is good by loading it into a scratch database: create `restore_check` with
   `createdb`, pipe the gunzipped dump into `psql -d restore_check`, compare row counts with the
   live one, drop it. This was done on staging on 2026-11-24 and matched.
2. To restore for real: stop `api` and `web`, recreate the database, load the dump, start them.

## Change checklist

- A new routine task, or a manual fix you had to do on a server: add it here.
- A change to `scripts/backup.sh`: run it on staging and do the scratch restore again.
- Anything scheduled on a host: record it in `.claude/skills/ops/references/environments.md`.
