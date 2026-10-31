/* X FORCE 1.4.4 — transactional e-mail (password recovery) through Resend's HTTP API.
   Settings (Cloudflare → the Worker → Settings → Variables and Secrets):
     RESEND_API_KEY   secret, required — an API key from resend.com (never sent to the browser, never logged)
     MAIL_FROM        text, required — e.g. "X FORCE <no-reply@your-domain.com>"; the domain must be verified in Resend
     APP_URL          text, optional — the address people open X FORCE at (e.g. https://xforce.your-domain.com); links use it
     RESEND_BASE_URL  tests only
   Nothing here logs addresses, links or tokens. */

export const mailConfigured = (env) => !!(env.RESEND_API_KEY && String(env.RESEND_API_KEY).length > 10 && env.MAIL_FROM && /@/.test(env.MAIL_FROM));

/** Send one message. Resolves {ok:true, id} when the provider accepted it, or {ok:false, error} — never throws. */
export async function sendMail(env, { to, subject, html, text }) {
  if (!mailConfigured(env)) return { ok: false, error: "E-mail is not configured." };
  const base = String(env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/+$/, "");
  try {
    const r = await fetch(base + "/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.id) return { ok: true, id: String(j.id).slice(0, 80) };
    return { ok: false, error: `The e-mail service refused the message (${r.status}${j && j.message ? ": " + String(j.message).slice(0, 120) : ""}).` };
  } catch (e) { return { ok: false, error: "The e-mail service could not be reached." }; }
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The branded recovery message (table layout and inline styles so it renders the same in Gmail, Outlook and phones). */
export function resetEmail({ name, link, minutes, byAdmin, origin }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const valid = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
  const why = byAdmin ? "An administrator started a password reset for your X FORCE account." : "Someone (hopefully you) asked to reset the password of your X FORCE account.";
  const subject = "Reset your X FORCE password";
  const text = `Hello ${first},\n\n${why}\n\nChoose a new password here (the link works once and expires in ${valid}):\n${link}\n\nIf you did not ask for this, ignore this e-mail: your password stays the same.\n\nDupedia X FORCE`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#FBFAF6;font-family:'Instrument Sans',Arial,Helvetica,sans-serif;color:#262626">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBFAF6"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FFFFFF;border:1px solid #DCDAD2;border-radius:18px">
<tr><td style="padding:28px 32px 0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td><img src="${esc(origin)}/brand/logo_compact.png" width="130" alt="Dupedia" style="display:block;border:0;width:130px;height:auto"></td>
<td align="right" valign="top"><div style="width:28px;height:28px;background:#B8D241;border-radius:0 18px 0 28px"></div></td></tr></table></td></tr>
<tr><td style="padding:24px 32px 0 32px"><h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;font-weight:600;color:#262626">Reset your X&nbsp;FORCE password</h1></td></tr>
<tr><td style="padding:14px 32px 0 32px;font-size:15px;line-height:1.6;color:#45453F">Hello ${esc(first)},<br>${esc(why)}</td></tr>
<tr><td style="padding:24px 32px 8px 32px"><a href="${esc(link)}" style="display:inline-block;background:#B8D241;color:#262626;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">Choose a new password</a></td></tr>
<tr><td style="padding:8px 32px 0 32px;font-size:13px;line-height:1.6;color:#5E5E58">The link works once and expires in ${valid}. If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;color:#45453F">${esc(link)}</span></td></tr>
<tr><td style="padding:20px 32px 28px 32px;font-size:13px;line-height:1.6;color:#5E5E58;border-top:1px solid #EAE8E1">If you did not ask for this, ignore this e-mail — your password stays the same. Nobody at Dupedia will ever ask you for your password.</td></tr>
</table><p style="margin:16px 0 0 0;font-size:12px;color:#5E5E58">Dupedia X FORCE · Serious about play.</p></td></tr></table></body></html>`;
  return { subject, html, text };
}

/** Sign-in instructions after an administrator issued a temporary password. The password itself is NEVER e-mailed. */
export function tempEmail({ name, username, hours, origin }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there", subject = "Your X FORCE sign-in has been reset";
  const text = `Hello ${first},\n\nAn administrator reset your X FORCE password and gave you a temporary one in person or by phone (it is never sent by e-mail).\n\nSign in at ${origin}/login with your username "${username}" and the temporary password within ${hours} hours, then choose your own password.\n\nIf you did not expect this, contact your administrator.\n\nDupedia X FORCE`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#FBFAF6;font-family:'Instrument Sans',Arial,Helvetica,sans-serif;color:#262626">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBFAF6"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#FFFFFF;border:1px solid #DCDAD2;border-radius:18px">
<tr><td style="padding:28px 32px 0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="${esc(origin)}/brand/logo_compact.png" width="130" alt="Dupedia" style="display:block;border:0;width:130px;height:auto"></td>
<td align="right" valign="top"><div style="width:28px;height:28px;background:#B8D241;border-radius:0 18px 0 28px"></div></td></tr></table></td></tr>
<tr><td style="padding:24px 32px 0 32px"><h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;font-weight:600">Your X&nbsp;FORCE sign-in has been reset</h1></td></tr>
<tr><td style="padding:14px 32px 0 32px;font-size:15px;line-height:1.6;color:#45453F">Hello ${esc(first)},<br>An administrator gave you a temporary password in person or by phone. For your safety it is never sent by e-mail.</td></tr>
<tr><td style="padding:16px 32px 0 32px;font-size:15px;line-height:1.7;color:#262626">1. Open X FORCE and sign in with your username <b>${esc(username)}</b> and the temporary password.<br>2. Choose your own password straight away.<br>3. The temporary password stops working after ${esc(hours)} hours, or as soon as you have chosen yours.</td></tr>
<tr><td style="padding:22px 32px 8px 32px"><a href="${esc(origin)}/login" style="display:inline-block;background:#B8D241;color:#262626;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">Open X FORCE</a></td></tr>
<tr><td style="padding:20px 32px 28px 32px;font-size:13px;line-height:1.6;color:#5E5E58;border-top:1px solid #EAE8E1">Did not expect this? Contact your administrator. Nobody at Dupedia will ever ask you for your password.</td></tr>
</table><p style="margin:16px 0 0 0;font-size:12px;color:#5E5E58">Dupedia X FORCE · Serious about play.</p></td></tr></table></body></html>`;
  return { subject, html, text };
}
