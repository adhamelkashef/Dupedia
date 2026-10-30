# X FORCE 1.1: self-hosted server

The same X FORCE app you use on claude.ai, served from your own server.

There are no dependencies to install. It needs Node.js 18 or newer, and Python 3 if you want the hourly server jobs.

## What you get

**Sign-in and accounts**
- People sign in with a username and password.
- There is no public registration. The first administrator is created once, using a one-time setup code. Everyone else is created by an administrator in **User Management**.
- At first sign-in, each person replaces their temporary password.

**Access rules, enforced on the server**
- The server enforces the same access rules as the claude.ai version, `DPStore.RULES` in `app/store.js`.
- They are checked on every read and write, according to the account's level: owner, administrator, or staff.
- Deactivating someone in X FORCE ends their sessions and blocks their sign-in immediately.

**Data, backups and jobs**
- Everything is stored in one data folder, `DATA_DIR`, as a snapshot plus a journal. The data survives restarts and crashes.
- A backup is made every day. Administrators can also download a full backup.
- The hourly sweep runs if Python 3 is installed: 24-hour lead release, follow-up reminders and overdue-payment reminders.
- There is a protected ingest endpoint for Market Intelligence research results.

**Security**
- Strict security headers, including a Content-Security-Policy and protection against being framed.
- Session cookies are HttpOnly and SameSite=Strict, and every write needs an anti-forgery header.
- Login rate limiting: 5 failures lock a username for 15 minutes. 30 failures from one address lock that address.
- Before sign-in, the server serves nothing except the sign-in page, fonts and the logo. It never serves `server/`, `qa/`, `ops/` or your data folder.

## Install

1. Copy the whole `X FORCE 1.1` folder to the server.
   - The folder `qa/` is only needed for testing and can be left out.
   - **Never upload `ops/costmodel.json` to a public place.** It holds manufacturing costs. The server never serves it.
2. Start the server:
   ```
   cd "X FORCE 1.1"
   PORT=8080 DATA_DIR=/var/lib/xforce node server/server.js
   ```
3. The first start prints a **one-time setup code** in the log. Open `http://<server>:8080/`, which redirects to `/setup`, and enter the code. Then create the owner account (the CEO).
4. Put it behind HTTPS before real use (see below).

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | Port to listen on |
| `HOST` | 0.0.0.0 | Interface to listen on |
| `DATA_DIR` | `server/var` | Data, accounts, sessions and backups. **Keep it outside the web root and back it up.** |
| `SETUP_CODE` | random | One-time code for creating the first administrator. If unset, it is printed in the log on first start. |
| `COOKIE_SECURE` | off | Set to `1` when the site is served over HTTPS directly |
| `TRUST_PROXY` | off | Set to `1` behind nginx or Caddy. The server then trusts `X-Forwarded-Proto` and `X-Forwarded-For`. |
| `SESSION_DAYS` | 14 | How long a sign-in lasts |
| `MAX_BODY_MB` | 4 | Largest request accepted. Files are sent in pieces of 180 kB or less. |
| `BACKUP_KEEP` | 7 | How many daily backups to keep |
| `STORAGE_QUOTA_MB` | 500 | The test server's quota, used for the storage warning in Settings |
| `STORAGE_WARN_MB` | 400 | Shows a warning in Settings › Storage above this size |
| `PYTHON` | python3 | Python used for the hourly sweep and the research ingest |
| `SWEEP` | on | Set to `0` to switch off the in-server hourly sweep |
| `RESEARCH_TOKEN` | — | Secret for `POST /api/ingest/<job>`. Without it, the endpoint is closed. |

## HTTPS with nginx (example)

```
server {
  listen 443 ssl; server_name xforce.example.com;
  ssl_certificate ...; ssl_certificate_key ...;
  client_max_body_size 5m;
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host;
               proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr; }
}
```
Start the server with `TRUST_PROXY=1 HOST=127.0.0.1`.

A systemd unit is in `server/xforce.service`.

## Moving your data from claude.ai

1. On claude.ai, open X FORCE as the owner and go to **Admin › Access & backup › Download full database export**.
2. Copy the file to the server and run:
   ```
   node server/server.js import xforce-full-export-YYYY-MM-DD.json
   ```
   A backup of the current server data is made first.
3. Create a server login for each person in **User Management**.
   - Their records already exist from the import. Create the account with the same name.
   - The account gets a **new** user id, so the person's old records stay under their claude.ai id.
   - Re-linking those records is a manual step; ask Claude to do it for you before you go live.
4. Private chats are not exported. They are end-to-end encrypted with keys that never leave each person's private area.

## Market Intelligence on the server

On claude.ai, research runs as Claude scheduled tasks with web search.

On the server, the deterministic part is built in:
- validation, de-duplication and scoring (`ops/intel.py`);
- storage and CEO notifications.

The research itself needs an external source. Send results to:

```
POST /api/ingest/<opportunities|news|fx|materials|weekly>
Authorization: Bearer $RESEARCH_TOKEN
Content-Type: application/json
<candidates in the format described in ops/research-task.md>
```

For example:
- an exchange-rate provider feeding `fx` daily;
- a supplier price list feeding `materials`;
- an AI research job (for example, a Claude scheduled task) posting `opportunities`, `news` and `weekly`.

Anything without a source URL is dropped. Nothing is ever invented by the server.

## Storage on a 500 MB test server

| Item | Size |
|---|---|
| Application files | ≈ 13 MB |
| Node.js | not included (system package) |
| Empty database | < 1 MB |

How the database grows:
- **Files.** Payment proofs, ID documents, pictures and attachments are stored inside the database in 180 kB pieces. Images are re-encoded to JPEG, 2000 px or smaller, so a typical proof is 0.2–0.8 MB. Each upload is capped at 6 MB.
- **Backups.** One full copy per day, 7 kept. With 50 MB of data, backups take about 350 MB.
  - On a 500 MB disk, set `BACKUP_KEEP=3` until you upgrade, and download a backup weekly.
- **Monitoring.** Settings › Storage shows real usage, the quota and free disk space. It warns at `STORAGE_WARN_MB`.

Financial evidence is never deleted automatically. Only old backups are rotated.

**When you upgrade:** move `DATA_DIR` to the larger disk, raise `BACKUP_KEEP`, and consider moving files to object storage. The file store is one function pair (`putFile` / `getFile` in `app/orders.js`), so this is the integration point.

## Commands

```
node server/server.js                         # run
node server/server.js import <file|folder>    # import a full export / backup / claude.ai dump folder
node server/server.js reset-password <user> <new password>
node server/server.js sweep                   # run the hourly sweep once, now
```
