# Charon Dashboard

Private Next.js dashboard for the Charon trading bot. Public hostname is
gated by Cloudflare Zero Trust Access; the Node process binds to localhost
only and reaches the public internet via a Cloudflare Tunnel.

## Architecture

- **Process**: Next.js 16 server, bound to `127.0.0.1:3000`, managed by PM2
  (`charon-dashboard`).
- **Storage**: opens `/opt/charon/charon.sqlite` in readonly mode via a lazy
  `Proxy` in `src/lib/db.ts`. WAL mode on the bot's DB lets reads happen
  while the bot writes.
- **Exposure**: `cloudflared` tunnel `charon-dashboard` reverse-proxies
  `charon.andreas-unggun.my.id` to `127.0.0.1:3000`. No inbound ports on the
  VPS.
- **Auth**: Cloudflare Zero Trust Access — one-time PIN to allow-listed
  emails, 24h sessions.

## Local dev

```bash
cd dashboard
npm install
CHARON_DB_PATH=/opt/charon/charon.sqlite npm run dev -- --hostname 127.0.0.1 --port 3000
```

`CHARON_DB_PATH` is required in dev because the default
`path.resolve(cwd, "..", "charon.sqlite")` only works when the dashboard
lives at `/opt/charon/dashboard/`.

## Tests

```bash
cd dashboard
npm test   # vitest, ~48 cases, in-memory SQLite fixtures
```

## Production (on the VPS)

The dashboard runs under PM2 as `charon-dashboard`, alongside the bot
(`charon`) and other PM2-managed processes.

```bash
pm2 status
pm2 logs charon-dashboard       # tail
pm2 logs charon-dashboard --lines 200
pm2 restart charon-dashboard
pm2 reload charon-dashboard     # zero-downtime
```

Logs land at `/var/log/pm2/charon-dashboard.{out,err}.log` per
`ecosystem.config.cjs`.

### Deploy a new version

```bash
cd /opt/charon
git pull
cd dashboard
npm install
CHARON_DB_PATH=/opt/charon/charon.sqlite npm run build
pm2 restart charon-dashboard
```

### Tunnel

`cloudflared` runs as a systemd service (its standard installer):

```bash
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -n 50
```

Tunnel config at `/etc/cloudflared/config.yml`; credentials at
`/etc/cloudflared/<tunnel-id>.json` (also stored at `~/.cloudflared/`).
Tunnel name: `charon-dashboard`. Hostname: `charon.andreas-unggun.my.id`.

### Access policy

Cloudflare Zero Trust → Access → Applications → `Charon Dashboard`.
Allowed emails managed there. Session 24h, identity provider is one-time PIN
by default.

## Spec & plan

See `docs/superpowers/specs/2026-05-21-dashboard-design.md` and
`docs/superpowers/plans/2026-05-21-dashboard.md` in the repo root.
