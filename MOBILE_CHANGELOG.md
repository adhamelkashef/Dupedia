# Changelog

## 1.4.6 — 31 Oct 2026 (prepared, not deployed)
- **Passwords:** administrators can reset the owner's password for recovery. The owner is alerted on the dashboard, in the inbox and by e-mail. Reset status shows whether a temporary password was used or expired, and "used" and "expired" are audited.
- **Sign-in:** a branded animation shows the official logo with "Signing in…" and "serious about play". It runs only while the server checks the password and continues until the dashboard is ready.
- **Commissions:**
  - New orders use rule C3: 3% up to and including EGP 1,000,000, 5% up to and including EGP 3,000,000, 7% above.
  - Approved commission is added to payroll automatically as its own line and is paid only when the salary payment is verified.
  - Duplicates are blocked.
  - Cancellations and value amendments are handled with an audit trail.
  - "My Commission" shows earned, pending, approved, in payroll, paid and outstanding.
- **Chat:** full redesign, with replies, reactions, edit/delete, read receipts, encrypted group chats, "active now" (optional), paging, offline handling, and phone and desktop layouts.
- Details: `XFORCE-1.4.6.md`.

## 1.4.5 — 31 Oct 2026
- Temporary login passwords for any account, a forced change at sign-in enforced by the server, and an audit log.

## 1.4.4 — 31 Oct 2026
- Password recovery by e-mail (Resend) and the "Needs your attention" redesign.
