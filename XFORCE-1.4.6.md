# X FORCE 1.4.6 — passwords, sign-in animation, commissions in payroll, chat redesign

**Built on:** 1.4.5, the version on GitHub on 31 Oct 2026. The request was titled "1.4.4", but the repository was already at 1.4.5.

**Tested:** on Cloudflare's local runtime with a fresh test database.

**Not yet:** on the live site. Nothing was deployed, and no real employee, payroll or chat records were touched.

## Owner decisions (31 Oct 2026)

1. **Owner password reset.** Any administrator may reset the owner's password, with no owner approval. The owner is always alerted.
2. **Commission bands.** The brief's bands apply to new orders, as rule **C3**:
   - 3% from EGP 500,000 up to and including 1,000,000;
   - 5% above 1,000,000 up to and including 3,000,000;
   - 7% above 3,000,000.
   - Commissions calculated earlier keep rule C2, which gave 5% at exactly 1,000,000 and 7% at exactly 3,000,000.
3. **Payroll.** Approved commissions are paid through payroll. Staff without a salary profile get a commission-only payroll line.
4. **Chat.** Group chat and "active now" are included in this release.

## 1. Admin password reset and temporary passwords

**Already in 1.4.5 (kept):**
- Temporary passwords: random, shown once, expiry chosen by the administrator.
- The change is forced at sign-in, and the server refuses everything else until then.
- Sessions are ended.
- Audit log entries.

**New in 1.4.6:**
- **Owner reset.** Any administrator can reset the **owner's** password, by temporary password or reset link. The owner always gets:
  - an **urgent** item in "Needs your attention" for 7 days;
  - an inbox alert;
  - a security e-mail, when e-mail is set up and the owner has an address.
- **Reset status in User Management.** For each temporary password: used (they chose their own), expired unused, replaced by a newer reset, or not used yet with the expiry time.
- **Audit log.** Adds "Temporary password used", "Temporary password expired" and "Owner password reset — owner alerted". No password ever appears.
- **Unchanged safeguards:**
  - nobody can reset their own password from User Management;
  - the owner can't be demoted or deactivated;
  - employees can't reset anyone's password.

## 2. Sign-in animation

- **What it shows:** the official logo (`brand/logo_primary.png`, unchanged) with "Signing in…" and "serious about play".
  - It is drawn with CSS only: no video, and the sign-in page is under 40 KB of HTML.
- **When:** only while the server checks the password. It never suggests success early.
  - **On success:** "Signed in — opening your dashboard…". The animation continues on the app page until the dashboard has rendered (12 seconds at most).
  - **Wrong password or no connection (20-second limit):** the animation stops, a clear error appears, and the form works again.
  - **Temporary password:** it goes straight to the "choose your own password" step.
- **Reduced motion:** the logo is shown still.

## 3. Commissions connected to employee accounts and payroll

- **Rule C3** for new orders. Same basis as before: the eligible order value is the subtotal after discount, excluding VAT, delivery and pass-through charges, at one rate for the whole order.
  - A saved configuration that still ran the standard C2 bands moves to C3 automatically.
  - A customised configuration is left alone.
- **Records.** One commission record per booked order. An existing record is never overwritten. Quotations never carry commission.
- **Payroll.**
  - Approved commission for the salary cycle (cut-off on the 25th), or earlier and still unpaid, is added **automatically** as its own "Commission" line when payroll is prepared, and while payroll is still being prepared.
  - Gross = base + allowances + bonuses + commission.
  - Payslips show the commission separately.
- **Lifecycle shown to people:** pending qualification → earned, awaiting approval → approved → included in payroll → paid, or cancelled / reversed.
  - Approving payroll does **not** mark a commission paid.
  - It becomes paid only when that salary payment is **verified** in Transfers.
- **No double counting.**
  - A commission can be in only one unpaid payroll.
  - While it is there, a separate payout (COM transaction or a manual "record payout") is refused.
  - The server checks every payroll commission line against the commission record.
  - Approved payroll, including its commission, is locked.
- **Corrections.**
  - **Cancelled order:** the commission is taken out of payroll that is still being prepared, with history kept.
  - **Reversal after payment:** recovered as a negative line in the next payroll.
  - **Order value amended:** a **proposed** adjustment is calculated under the commission's own rule. Nothing changes until an administrator applies it, and it is then kept as a documented adjustment.
- **Employee's "My Commission" page:**
  - totals: total earned, pending, approved, included in payroll, paid, outstanding;
  - per deal: qualifying amount, rate, commission, status and payroll month;
  - a "Commission by payroll period" table.
  - Employees see only their own records, enforced by the server, and no costs or margins.

## 4. Chat redesign

The backend stays the same: same storage, same end-to-end encryption, and existing messages are unchanged.

- **Conversation list:**
  - Company Wall first, then pinned conversations, then the most recent;
  - profile pictures, group avatars, last-message preview, time and unread badges;
  - search across names and message text;
  - "Active now".
- **Conversation screen:**
  - day separators and grouped bubbles;
  - replies with a quote;
  - emoji reactions with counts;
  - editing your own messages for 24 hours ("edited");
  - deleting your own messages ("This message was deleted");
  - image previews and document cards;
  - real read receipts: "Seen" only once the reader's app has recorded it, "Seen by N" in groups;
  - loading, empty and error states, and arrival animations (none when reduced motion is on).
- **Group chats.** End-to-end encrypted: a random group key is wrapped for each member. Members learn about a group from an inbox notification that carries only its id. People can be added and can leave.
- **Paging.**
  - Private and group conversations load the newest 40 messages, then only newer ones; "Load earlier messages" pages back.
  - The Company Wall reads only what was written since the last read.
- **Presence.** A heartbeat while X FORCE is open; "Active now" means a heartbeat in the last 2 minutes. Anyone can switch it off in Chat settings, and then nothing about their activity is shown.
- **Offline.** A clear banner. A message typed while offline stays in the box and is sent on retry.
- **Themes and layout.** Three light themes (Lime, Charcoal, Stone). On a phone, one pane at a time. On a desktop, the list and the conversation side by side, plus the compact panel on every page.
- **Server additions (backward compatible):**
  - paged `list` (`after`, `before`, `limit`, `since`);
  - a `presence/{self}` permission rule.

**Known limits, stated honestly:**
- In an encrypted chat both people hold the key. A participant who tampered with their own app could forge an "edit" in a private chat. Every edit or deletion is accepted only from the original author's messages, and on the Wall the storage path proves the author.
- Search covers the messages already loaded on the device; the server cannot search encrypted messages.

## Files changed

- `worker/index.js`, `worker/mail.js`
- `xf-shim.js`, `index.html`
- `app/chat.js`, `app/ui-chat.js`
- `app/commission.js`, `app/sales.js`, `app/finance.js`, `app/fincalc.js`, `app/orders.js`
- `app/ui-comm.js`, `app/ui-fin2.js`, `app/ui-users.js`, `app/ui-ceo.js`, `app/ui-shell.js`
- `app/store.js`, `app/xf-ui.css`
- `CLOUDFLARE.md`, this file

## Tests (`qa/`, run on wrangler dev)

| Suite | Checks |
|---|---|
| `e2e_temp_password.py` (all account types, owner recovery, used/expired, audit, no leaks) | 33 |
| `e2e_signin_anim.py` (success, wrong password, no connection, temporary password, phone, reduced motion) | 12 |
| `e2e_comm_payroll.py` (3/5/7% and the thresholds, payroll inclusion, duplicates, paid only on verified salary, cancellation, amendment, privacy, payslip) | 29 |
| `e2e_chat.py` (history kept, send/receive, unread, Seen, reply, reactions, edit/delete, attachments, groups, search, notifications, pinning, paging, Wall, presence, offline, phone and desktop, side panel) | 24 |

The earlier suites (`e2e_cf`, `e2e_fin`, `e2e_growth`, `e2e_ops`, `e2e_recovery`, `e2e_research`, `e2e_research_claude`, research queue, intel parity) were re-run for regressions.

## To deploy (after your approval)

1. Upload the files in the zip to GitHub. Cloudflare deploys from GitHub as before.
2. No new secrets are needed. Optional: `TEMP_PASSWORD_HOURS` and `TEMP_PASSWORD_MAX_HOURS`.
3. After deploying, check:
   - sign in once (to see the animation);
   - open Messages;
   - in Finance → Salaries & payroll, prepare the current month and confirm that approved commissions appear as their own line.
