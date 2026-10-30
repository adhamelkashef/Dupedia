# X FORCE 1.4 on Cloudflare — live, shared, signed-in

Everyone opens the same address and signs in with their own username and password. They all work on the same orders, payments, leads and engineering records, stored in one Cloudflare D1 database.

## How it fits together

| Part | What it is |
|---|---|
| Website files | The unchanged X FORCE app: `index.html`, `app/`, `img/`, `vendor/`, … |
| `worker/index.js` | The backend. It handles sign-in, one-time setup, the shared database API, permission checks, backup and the hourly sweep. |
| `worker/sweep.js` | The hourly job: 24-hour lead release, follow-up reminders and overdue customer payments. It is a JavaScript port of `ops/sweep.py` and gives identical results on all its test cases. |
| `xf-shim.js` | Connects the app to the backend. It contains no secrets. |
| D1 database `xforce-db` | All business data: people, leads, quotations, orders, payments and their proof files, engineering, commission, messages. |
| `wrangler.jsonc` | Cloudflare configuration. |

## 1.4 — Growth & Marketing Center

- **New role: Marketing** (staff level). Campaigns and content, Project Radar, partnerships, sending accounts to the Lead Mine. No orders, prices, costs, salaries or other people's commission — the Worker refuses them.
- **No external service is connected.** Nothing is published, advertised or sent by X FORCE: content is approved by an administrator in X FORCE and posted by a person on the platform. Draft texts are built from the product catalogue with templates, not an AI service. No paid API, key or subscription is needed.
- **Spend** is what Finance records as a verified payment linked to the campaign (Transfers → "Marketing campaign").
- **Database:** new records only (`mkt/…`); leads gain a `campaignId` field. Nothing existing is changed.

## 1.3 — Factory & Operations

- **Live updates.** Each open page asks the Worker every 8 seconds (every 60 seconds in a background tab) which records it may read have changed (`/api/changes`), and redraws only what changed. No extra Cloudflare product is needed. Expect roughly 4,500 requests per person per 10-hour working day: the free plan's 100,000 requests a day covers about 15–20 people working all day; above that, use the Workers Paid plan.
- **Notifications** from staff are delivered by the Worker straight into the recipient's inbox; "Mark all as read" and "Clear all" are one server request (`/api/notif`).
- **The hourly job** also sends due reminders, production deadline and maintenance alerts, and payment dates that fall on bank closures (`app/jobs13.js`).
- **Internal folders are never served**: the Worker answers 404 for `/ops/…`, `/server/…` and `/qa/…` even if they are in the repository.
- **Database:** new records only (`fac/…`, `facc/…`, `prod/…`, `prodx/…`, `rem/…`, `hol/cal`), one new index on `docs(at)` and one new table `gone` (deleted paths for the change feed). Both are created automatically on first use; nothing existing is changed.

## 1.2 — Finance Command Center

- **New role: Accountant** (department Finance). Create it in User Management like any other user and choose the role *Accountant*. The server then gives that login its own access level, `finance`: the ledger, accounts, payroll, purchases, invoices, taxes and reports — but no user administration, settings, backups or CEO intelligence.
- **What the Accountant may approve** is set by the Administrator in *Finance Dashboard › Finance settings*. The Worker enforces these switches and the separation of duties (whoever prepares or records a payment cannot approve or verify it).
- **Balances are book balances** calculated from verified transactions. X FORCE is not connected to any bank: reconcile by importing the bank's CSV statement in *Financial Accounts*.
- **Tax rules are entered by you**, each with its source and effective date. X FORCE does not supply rates and does not file anything.
- **No database migration is needed.** Finance data are new records in the same D1 table (`fin/…`, `payslips/…`, `audit/…`, `leadx/…`); existing records are untouched.

The permission rules are the app's own access rules (`DPStore.RULES` in `app/store.js`), the same table used on claude.ai. They are checked by the Worker on every read and write, so a salesperson cannot fetch costs, margins, salaries, balances or another person's commission even by calling the API directly. In 1.2 the Worker also checks the content of finance writes (status changes, approvals, frozen verified transactions and issued invoices, receipts only for verified payments) and keeps an append-only audit trail (`audit/…`) whose author and time it stamps itself.

## One-time Cloudflare setup

1. **Build settings.** Go to Workers & Pages → your project → Settings → Build.
   - Build command: leave it empty.
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
2. **Worker name.** The `"name"` in `wrangler.jsonc` must be exactly the name of your Worker in Cloudflare. It is set to `dupedia`. If your Worker has another name, change that line.
3. **Commit and push.** Cloudflare rebuilds automatically. On the first deploy, wrangler creates the D1 database `xforce-db` and connects it.
   - If the build log says it could not create the database, create it yourself: Storage & Databases → D1 → Create database, named exactly `xforce-db`. Then redeploy (Deployments → Retry).
4. **Setup code.** Go to Settings → Variables and Secrets → **Add**.
   - Type: **Secret**
   - Name: `SETUP_CODE`
   - Value: a long random code only you know (at least 8 characters; 20 or more is better).
   - Save. Secrets are never shown again, never in GitHub, and kept across deploys.
5. **Create the owner account.** Open your `workers.dev` address. It goes to **/setup**. Enter the setup code, your name, a username and a password.
   - This creates the owner (CEO) account.
   - Setup then closes for good, even with the right code.
6. **Add your team.** Sign in, go to **User Management → Add user**, and set a username and role.
   - Pass on the username and the temporary password shown.
   - At first sign-in, each person must choose their own password.

## Settings in `wrangler.jsonc` → `vars`

| Variable | Default | Meaning |
|---|---|---|
| `PBKDF2_ITERATIONS` | 60000 | Password-hashing strength. The Workers **Free** plan allows 10 ms of CPU per request; 60,000 rounds take about 7 ms. On **Workers Paid**, raise it to `100000` (the Workers maximum). Existing passwords keep working: each hash stores its own rounds. |
| `SESSION_DAYS` | 14 | How long a sign-in lasts. |
| `STORAGE_QUOTA_MB`, `STORAGE_WARN_MB` | 500, 400 | Shown in Settings › Storage. D1 Free allows 500 MB per database. |

Secrets go only in the dashboard as **Secret**, never in this file. The only secret is `SETUP_CODE`.

## Security summary

- **Accounts.** There is no public sign-up. The first administrator needs `SETUP_CODE`, and setup can only ever run once. All other accounts are created by an administrator.
- **Passwords** are hashed with PBKDF2-SHA256 and a random salt.
- **Sign-in protection.**
  - 5 wrong passwords lock that username for 15 minutes.
  - 30 failures from one address lock that address.
- **Sessions** use an HttpOnly, Secure, SameSite=Strict cookie.
  - Every change must carry an anti-forgery header.
  - Deactivating someone or resetting their password ends their sessions at once.
- **Permissions** are checked by the Worker for every document, including payment proofs and National ID files, which are stored inside protected database records with no public URL.
- **What is public.** Before sign-in, only the sign-in page and the app's own code and images are reachable; those contain no business data. Backend code, configuration, git data and packages are never served (`.assetsignore`).

## Backups

- **Admin › Settings › Storage → Download backup** downloads the whole database as one JSON file.
- **D1 Time Travel** can restore the database to any minute in the last 7 days (Free) or 30 days (Paid): Storage & Databases → D1 → `xforce-db` → Time Travel.

## Free plan limits to know

- **CPU.** Each request may use up to 10 ms of CPU. Sign-in is tuned for that. Very large lists may occasionally fail with error 1102; if that happens, the Workers Paid plan ($5/month) removes the limit.
- **Requests.** 100,000 requests per day to the backend. Images and app files don't count.
- **Database.** 500 MB per database and 100,000 written rows per day.
- **Scheduled jobs.** The hourly sweep is 1 of the 5 scheduled jobs a free account can have.

## Not on Cloudflare yet

- **Market Intelligence research.** Opportunities, news, currency and material prices run as Claude scheduled tasks for the claude.ai version. `/api/ingest` answers "not available".
- **Private chats.** They are end-to-end encrypted and start empty here.
- **Email and phone notifications.** Notifications are in-app only.

## Testing locally (optional)

```
npm ci
echo "SETUP_CODE=choose-a-local-code" > .dev.vars
npx wrangler dev        # http://localhost:8787 — local D1, nothing touches the live database
```
