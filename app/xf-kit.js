/* X FORCE 2.0 "Snap" — internal design-system specimen (Session 2). Administrators only: open X FORCE at #xfkit.
   Shows every token and component in light and dark, English and Arabic, so later sessions build screens from one kit.
   Example content is labelled as such. The ID card preview uses the signed-in administrator's own record. */
/* global DPUI, DPAuth, DPSales, DPStore */
(function (root) {
  "use strict";
  const U = root.DPUI, XF = root.XF; if (!U || !XF) return;
  const { $, esc } = U, ic = XF.icon, mk = XF.mark;
  const EX = '<span class="x-pill">Example</span>';
  const sec = (id, title, lead, body) => `<section class="xk-sec" id="xks-${id}"><header class="xk-h"><h2 class="x-display x-d4">${title}</h2>${lead ? `<p class="x-muted">${lead}</p>` : ""}</header>${body}</section>`;
  const tokenRow = (names) => names.map((n) => `<div class="xk-sw"><i style="background:var(${n})"></i><code>${n}</code><span class="x-num" data-tok="${n}"></span></div>`).join("");

  let themeSet = false;
  function render() {
    const V = $("#view-xfkit"); if (!V) return;
    if (!U.isAdmin()) { V.innerHTML = `<div class="page"><div class="x-state"><div class="x-state__glyph"><i></i><i></i><i></i><i></i></div><h3>For administrators</h3><p>The design kit is an internal page.</p></div></div>`; return; }
    const me = U.me() || {};
    V.innerHTML = `<style>
      #view-xfkit .xk{max-width:1240px;margin:0 auto;padding-block:28px 96px;padding-inline:max(16px,env(safe-area-inset-left,0px)) max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:56px;font-family:var(--x-f-text);color:var(--x-fg)}
      #view-xfkit .xk>*,#view-xfkit .xk-sec,#view-xfkit .xk-grid>*{min-width:0}
      #view-xfkit .xk-h{display:flex;flex-direction:column;gap:6px;margin-bottom:20px;max-width:72ch}
      #view-xfkit .xk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--_min,240px),1fr));gap:16px}
      #view-xfkit .xk-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
      #view-xfkit .xk-sw{display:grid;grid-template-columns:36px 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;font-size:12px}
      #view-xfkit .xk-sw i{grid-row:span 2;width:36px;height:36px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--x-line)}
      #view-xfkit .xk-sw code{font:600 12px/1.2 ui-monospace,Menlo,monospace;color:var(--x-fg)} #view-xfkit .xk-sw span{color:var(--x-muted)}
      #view-xfkit .xk-icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px}
      #view-xfkit .xk-icons div{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 4px;border-radius:8px;font-size:11px;color:var(--x-muted);text-align:center;overflow-wrap:anywhere}
      #view-xfkit .xk-icons div:hover{background:var(--x-sunk);color:var(--x-fg)}
      #view-xfkit .xk-bar{position:sticky;top:0;z-index:5;background:var(--x-bg);padding-block:10px;border-bottom:1px solid var(--x-line);display:flex;flex-wrap:wrap;gap:12px;align-items:center}
      @media (max-width:640px){#view-xfkit .xk-bar{position:static}}
      #view-xfkit .xk-type>*{margin:0 0 10px} #view-xfkit .xk-scale{display:grid;grid-template-columns:90px minmax(0,1fr);overflow-wrap:anywhere;gap:14px 16px;align-items:baseline}
      #view-xfkit .xk-motion .x-ball{width:22px;height:22px}
      #view-xfkit .xk-track{position:relative;height:36px;background:var(--x-sunk);border-radius:999px;flex:1;min-width:220px;overflow:hidden}
      #view-xfkit .xk-track .x-ball{position:absolute;top:7px;left:8px;background:var(--x-lime)}
      #view-xfkit .xk-loader{border:1px dashed var(--x-line-strong);border-radius:8px;min-height:120px}
      #view-xfkit .xk-nav{background:var(--x-deck);padding:14px;border-radius:8px 28px 8px 8px;display:flex;flex-direction:column;gap:4px;max-width:300px}
    </style>
    <div class="xk" id="xk">
      <div class="x-hero is-in x-on-deck" data-x-dept="strategic">
        <div class="x-hero__eyebrow">${mk("strategic", { size: "sm" })} Internal · design system</div>
        <h1 class="x-hero__title">X FORCE 2.0, built from <em>blocks.</em></h1>
        <p class="x-hero__lead">Every token and component of the "Snap" system. Later sessions build screens only from what is on this page. Numbers below are examples unless marked otherwise.</p>
      </div>
      <div class="xk-bar" role="toolbar" aria-label="Preview settings">
        <span class="x-label">Theme</span><div class="x-switcher x-switcher--light" id="xk-theme"><button type="button" data-v="" aria-pressed="true">System</button><button type="button" data-v="light" aria-pressed="false">Light</button><button type="button" data-v="dark" aria-pressed="false">Dark</button></div>
        <span class="x-label">Direction</span><div class="x-switcher x-switcher--light" id="xk-dir"><button type="button" data-v="ltr" aria-pressed="true">English · LTR</button><button type="button" data-v="rtl" aria-pressed="false">Arabic · RTL</button></div>
        <span class="x-muted" style="font-size:12px">Theme and direction apply to this page only and reset when you leave it.</span>
      </div>
      <div id="xk-body" style="display:flex;flex-direction:column;gap:56px"></div>
    </div>`;
    const body = $("#xk-body");
    const dept = ["strategic", "sales", "finance", "factory", "planner"];
    const allIcons = Object.keys(U.ICON).concat(XF.ICONS_ADDED);

    body.innerHTML = [
      sec("colour", "Colour", "Brand core and division colours from the brand book. Cream, charcoal and lime carry every screen; each surface uses at most one division colour, for orientation only.",
        `<div class="xk-grid" style="--_min:200px">${tokenRow(["--x-cream", "--x-white", "--x-stone", "--x-charcoal", "--x-graphite", "--x-pebble", "--x-lime", "--x-coral", "--x-sun", "--x-lagoon", "--x-iris"])}</div>
         <h3 class="x-label" style="margin:24px 0 12px">Semantic (changes with the theme)</h3>
         <div class="xk-grid" style="--_min:200px">${tokenRow(["--x-bg", "--x-surface", "--x-sunk", "--x-line", "--x-fg", "--x-fg2", "--x-muted", "--x-deck", "--x-ok", "--x-warn", "--x-err", "--x-info"])}</div>`),
      sec("type", "Typography", "Fraunces SemiBold (soft) for display, with one italic accent word per headline. Instrument Sans for everything else. Readex Pro for Arabic, set 10% larger.",
        `<div class="x-card xk-scale">
          <span class="x-label">D1 56</span><p class="x-display x-d1">Places to <em>play.</em></p>
          <span class="x-label">D2 40</span><p class="x-display x-d2">Production <em>flow</em></p>
          <span class="x-label">D3 32</span><p class="x-display x-d3">Completed projects</p>
          <span class="x-label">D4 24</span><p class="x-display x-d4">Payment verification</p>
          <span class="x-label">Body 16</span><p style="font-size:16px;max-width:62ch">We design, supply and install play and leisure attractions, from a single school playground to a full water park.</p>
          <span class="x-label">UI 14</span><p style="font-size:14px">Recorded payments are verified by Finance before they count as collected.</p>
          <span class="x-label">Code 13</span><p class="x-code">DP-PG-0000 · 12.40 × 8.20 × 4.10 M · AGES 3–12</p>
          <span class="x-label">Label 12</span><p class="x-label">Project · Palm Residence · 2026</p>
          <span class="x-label">Arabic</span><p lang="ar" dir="rtl" style="font-size:22px;font-weight:600">أماكن يحب الناس اللعب فيها</p>
        </div>`),
      sec("space", "Space, radius, elevation", "A 4-point space scale. Square corners for structure, the 28 px quarter corner once per card, pills for buttons. Resting things are flat; only layers that float cast a shadow.",
        `<div class="xk-grid" style="--_min:260px">
          <div class="x-card"><div class="x-card__h"><h3>Space</h3></div>${[4, 8, 12, 16, 24, 32, 48, 64].map((s, i) => `<div class="xk-row" style="margin-bottom:6px"><code style="width:70px;font-size:12px">--x-s${i + 1}</code><i style="display:block;height:10px;width:${s}px;background:var(--x-lime);border-radius:2px"></i><span class="x-muted x-num" style="font-size:12px">${s}</span></div>`).join("")}</div>
          <div class="x-card"><div class="x-card__h"><h3>Radius</h3></div><div class="xk-row">${[["xs 4", "var(--x-r-xs)"], ["sm 8", "var(--x-r-sm)"], ["corner 28", "var(--x-r-sm) var(--x-r-corner) var(--x-r-sm) var(--x-r-sm)"], ["pill", "var(--x-r-pill)"]].map(([l, r]) => `<div style="display:flex;flex-direction:column;gap:6px;align-items:center;font-size:12px"><i style="display:block;width:64px;height:48px;background:var(--x-stone);border-radius:${r}"></i>${l}</div>`).join("")}</div></div>
          <div class="x-card"><div class="x-card__h"><h3>Elevation</h3></div><div class="xk-row">${["e0", "e1", "e2", "e3"].map((e) => `<div style="display:flex;flex-direction:column;gap:8px;align-items:center;font-size:12px"><i style="display:block;width:56px;height:44px;background:var(--x-surface);border-radius:8px;box-shadow:var(--x-${e}),0 0 0 1px var(--x-line)"></i>${e}</div>`).join("")}</div><p class="x-muted" style="font-size:12px;margin-top:12px">e1 hover lift · e2 menus, toasts · e3 dialogs</p></div>
        </div>`),
      sec("motion", "Motion", "Durations 120 / 200 / 320 / 520 ms. Snap overshoots about 4%, like a part clicking home. Reduced motion turns movement into a short fade.",
        `<div class="x-card xk-motion"><div class="xk-row">${[["snap", "var(--x-snap)"], ["settle", "var(--x-settle)"], ["exit", "var(--x-exit)"]].map(([n, e]) => `<div class="xk-row" style="flex:1 1 280px"><button type="button" class="x-btn x-btn--sm x-btn--dark" data-ease="${n}">${n}</button><div class="xk-track" data-track="${n}"><span class="x-ball" style="transition:left var(--x-d-lg) ${e}"></span></div></div>`).join("")}</div></div>`),
      sec("icons", "Icons", `One family: 24 px grid, 2 px stroke, round ends. ${allIcons.length} icons — the 1.x set plus the 2.0 additions. Animated states answer events and never loop.`,
        `<div class="xk-row" style="margin-bottom:16px"><button type="button" class="x-btn x-btn--ghost x-btn--sm" id="xk-ring">${ic("bell", { size: "md" })} Alert arrives</button><button type="button" class="x-btn x-btn--ghost x-btn--sm" id="xk-draw">${ic("checkCircle", { size: "md" })} Payment verified</button><button type="button" class="x-btn x-btn--ghost x-btn--sm" id="xk-turn">${ic("gearTurn", { size: "md" })} Order moves stage</button><button type="button" class="x-btn x-btn--ghost x-btn--sm">Next ${ic("arrowRight", { size: "md", cls: "x-ic--nudge" })}</button></div>
         <div class="x-card"><div class="xk-icons">${allIcons.map((k) => `<div title="${esc(k)}">${ic(k)}<span>${esc(k)}</span></div>`).join("")}</div></div>`),
      sec("marks", "Division marks", "Traced from brand book page 5: a 2×2 grid of blocks on the division colour. Each X FORCE department uses one. Click to snap.",
        `<div class="xk-row" style="gap:28px">${dept.map((d) => `<button type="button" class="xk-mark" data-mark style="border:0;background:none;padding:0;cursor:pointer;display:flex;flex-direction:column;gap:8px;align-items:center;font:600 13px var(--x-f-text);color:var(--x-fg)">${mk(d, { size: "lg" })}${esc(XF.DEPT_LABEL[d])}</button>`).join("")}</div>`),
      sec("buttons", "Buttons", "Pill buttons (brand rule). Lime is the one primary action per area; charcoal is secondary.",
        `<div class="x-card"><div class="xk-row"><button class="x-btn x-btn--primary">${ic("plus")} Record payment</button><button class="x-btn x-btn--dark">Approve</button><button class="x-btn">Save draft</button><button class="x-btn x-btn--ghost">Cancel</button><button class="x-btn x-btn--danger">Reject</button><button class="x-btn x-btn--icon x-btn--ghost" aria-label="More">${ic("more")}</button><button class="x-btn" disabled>Disabled</button></div>
         <div class="xk-row" style="margin-top:14px"><button class="x-btn x-btn--primary x-btn--lg" id="xk-busy">Busy, then done</button><button class="x-btn x-btn--sm">Small</button><span data-x-dept="finance"><button class="x-btn x-btn--dept">Department action</button></span></div></div>`),
      sec("fields", "Fields", "Large touch targets, a lime underline that grows on focus, and errors that say what to fix.",
        `<div class="x-card"><div class="xk-grid" style="--_min:260px">
          <label class="x-field"><span>Client name</span><input class="x-input" placeholder="e.g. Palm Residence"><small>As it should appear on the proposal.</small></label>
          <label class="x-field"><span>Password</span><div class="x-input-wrap" id="xk-pw"><input class="x-input" type="password" value="example-only" autocomplete="off"><button class="x-reveal"></button></div></label>
          <label class="x-field"><span>Stage</span><select class="x-input"><option>Quotation</option><option>Signed</option><option>In production</option></select></label>
          <label class="x-field is-invalid" id="xk-inv"><span>Amount (EGP)</span><input class="x-input x-num" value="-500"><span class="x-err-msg">${ic("warning", { size: "sm" })} Enter an amount above zero.</span></label>
          <label class="x-field" style="grid-column:1/-1"><span>Note</span><textarea class="x-input" placeholder="What did the client agree to?"></textarea></label>
          <label class="x-check"><input type="checkbox" checked> Compare with the previous period</label>
        </div></div>`),
      sec("cards", "Cards and panels", "Square structure with one quarter corner. Hover lifts only what you can open.",
        `<div class="xk-grid">
          <div class="x-card"><div class="x-card__h"><h3>Plain card</h3></div><p class="x-muted">Hairline border, no shadow at rest.</p></div>
          <div class="x-card x-card--corner"><div class="x-card__h"><h3>Corner card</h3></div><p class="x-muted">The quarter corner, once per card.</p></div>
          <div class="x-card x-card--corner x-card--mark" data-x-dept="sales"><div class="x-card__h"><h3>Marked card</h3></div><p class="x-muted">Department corner mark.</p></div>
          <div class="x-card x-card--corner x-card--deck x-on-deck"><div class="x-card__h"><h3>Deck card</h3></div><p style="color:var(--x-on-deck-2)">Charcoal with tonal light.</p></div>
          <a class="x-card x-card--corner x-card--hover" href="#xfkit" onclick="return false"><div class="x-card__h"><h3>Opens something</h3>${ic("arrowRight", { cls: "x-ic--nudge" })}</div><p class="x-muted">Lifts on hover.</p></a>
          <details class="x-card x-panel"><summary>Expandable panel</summary><p class="x-muted" style="margin-top:12px">Folded sections remember nothing by themselves; screens decide.</p></details>
        </div>`),
      sec("hero", "Hero band and metrics", `One lead metric, then support. Deltas only where a previous period exists. ${EX}`,
        `<div class="x-hero is-in x-on-deck" data-x-dept="sales" id="xk-hero"><div class="x-hero__eyebrow">${mk("sales", { size: "sm" })} Sales · this month</div><h2 class="x-hero__title">My <em>pipeline</em></h2>
          <div class="x-hero__metrics"><div class="x-metric x-metric--lead"><span class="x-metric__label">Open quotations</span><span class="x-metric__value" data-count="12">12</span><span class="x-delta x-delta--up">+3 vs last month</span></div>
          <div class="x-metric"><span class="x-metric__label">Signed</span><span class="x-metric__value" data-count="4">4</span><span class="x-metric__note">orders</span></div>
          <div class="x-metric"><span class="x-metric__label">Follow-ups due</span><span class="x-metric__value" data-count="2">2</span><span class="x-delta x-delta--flat">same as last week</span></div></div>
          <div class="x-hero__acts"><button class="x-btn x-btn--primary">${ic("plus")} New quotation</button><button class="x-btn x-btn--ghost">Open Lead Mine</button></div></div>
         <div class="x-metrics" style="margin-top:16px">${[["Verified payments", "EGP 0.00", "in the period", ""], ["Awaiting verification", "5", "payments", "x-delta--down|+2"], ["Payroll due", "EGP 0.00", "prepared, not paid", ""], ["Commissions to approve", "3", "records", ""]].map(([l, v, n, d]) => `<div class="x-metric"><span class="x-metric__label">${l}</span><span class="x-metric__value">${v}</span>${d ? `<span class="x-delta ${d.split("|")[0]}">${d.split("|")[1]}</span>` : `<span class="x-metric__note">${n}</span>`}</div>`).join("")}</div>`),
      sec("status", "Status", "Pills carry state in words and colour; the ball is the smallest status mark; counts sit on menu items.",
        `<div class="x-card"><div class="xk-row"><span class="x-pill x-pill--ok">Verified</span><span class="x-pill x-pill--warn">Awaiting verification</span><span class="x-pill x-pill--err">Overdue</span><span class="x-pill x-pill--info">Issued</span><span class="x-pill">Draft</span><span data-x-dept="factory"><span class="x-pill x-pill--dept">In production</span></span>
          <span class="x-ball x-ball--ok"></span><span class="x-ball x-ball--warn"></span><span class="x-ball x-ball--err"></span><span class="x-ball x-ball--info"></span><span class="x-count">3</span><button class="x-btn x-btn--sm x-btn--ghost" id="xk-pill">Change state</button></div></div>`),
      sec("progress", "Progress", "Bands fill by real progress or by completed steps. The ring and bar show measured percentages only.",
        `<div class="xk-grid" style="--_min:260px">
          <div class="x-card"><div class="x-card__h"><h3>Block band</h3></div><div class="x-band" id="xk-band"><i></i><i></i><i></i><i></i></div><div class="xk-row" style="margin-top:14px"><button class="x-btn x-btn--sm" data-band="-1">−</button><button class="x-btn x-btn--sm x-btn--dark" data-band="1">+ step</button></div></div>
          <div class="x-card"><div class="x-card__h"><h3>Bar and ring</h3></div><div class="x-bar" id="xk-bar" style="--_p:40%"><b></b></div><div class="xk-row" style="margin-top:16px"><div class="x-ring" id="xk-ring2" style="--_p:40"><svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="15.9155"/><circle class="val" cx="18" cy="18" r="15.9155" pathLength="100"/></svg><b>40%</b></div><input type="range" min="0" max="100" value="40" id="xk-range" aria-label="Example percentage" style="flex:1"></div></div>
          <div class="x-card"><div class="x-card__h"><h3>Steps</h3></div><ol class="x-steps"><li class="is-done"></li><li class="is-done"></li><li class="is-now"></li><li></li><li></li></ol><p class="x-muted" style="margin-top:10px;font-size:13px">Generating proposal · page 3 of 5</p></div>
          <div class="x-card"><div class="x-card__h"><h3>Unknown wait</h3></div><div class="x-bar x-bar--wait"><b></b></div><p class="x-muted" style="margin-top:10px;font-size:13px">Checking your account…</p><div class="x-skel" style="height:14px;margin-top:12px;width:70%"></div><div class="x-skel" style="height:14px;margin-top:8px;width:45%"></div></div>
        </div>`),
      sec("loader", "Loader", "One loader for every long operation. These demos simulate timing; the real loader only shows a percentage from measured bytes or rows.",
        `<div class="xk-row" style="margin-bottom:12px">${[["wait", "Unknown wait"], ["steps", "Known steps"], ["percent", "Measured %"], ["timeout", "Timeout (demo: 4 s)"], ["fail", "Error"], ["screen", "Full screen"]].map(([k, l]) => `<button class="x-btn x-btn--sm${k === "screen" ? " x-btn--dark" : ""}" data-load="${k}">${l}</button>`).join("")}</div>
         <div class="xk-loader" id="xk-load"></div>`),
      sec("feedback", "Toasts and dialogs", "",
        `<div class="xk-row"><button class="x-btn" data-toast="ok">Success toast</button><button class="x-btn" data-toast="err">Error toast</button><button class="x-btn" data-toast="undo">Toast with action</button><button class="x-btn x-btn--dark" id="xk-dlg-open">Open dialog</button></div>
         <dialog class="x-dialog" id="xk-dlg"><form method="dialog" class="x-dialog__in"><h2 class="x-display x-d4">Approve commission?</h2><p class="x-muted">It moves to payroll for the October cycle. ${EX}</p><div class="x-dialog__acts"><button class="x-btn x-btn--ghost" value="no">Cancel</button><button class="x-btn x-btn--primary" value="yes">Approve</button></div></form></dialog>`),
      sec("table", "Table", "Sticky header, tabular numbers aligned to the end, rows stack into label–value pairs on phones.",
        `<div class="x-table-wrap"><table class="x-table x-table--stack"><thead><tr><th>Order</th><th>Client</th><th>Stage</th><th class="r">Value (EGP)</th></tr></thead><tbody>
          ${[["[DUP-2026-001]", "[Client]", "x-pill--ok|Signed", "0.00"], ["[DUP-2026-002]", "[Client]", "x-pill--warn|Awaiting deposit", "0.00"], ["[DUP-2026-003]", "[Client]", "x-pill--info|Issued", "0.00"]].map(([o, c, s, v]) => `<tr class="is-click"><td data-label="Order"><span class="x-code">${o}</span></td><td data-label="Client">${c}</td><td data-label="Stage"><span class="x-pill ${s.split("|")[0]}">${s.split("|")[1]}</span></td><td data-label="Value" class="r">${v}</td></tr>`).join("")}</tbody></table></div>`),
      sec("tabs", "Tabs and timeline", "",
        `<div class="x-card" data-x-dept="finance"><div class="x-tabs" id="xk-tabs"><button class="x-tab" data-tab="a" aria-selected="true">Overview</button><button class="x-tab" data-tab="b" aria-selected="false">CEO overview</button><button class="x-tab" data-tab="c" aria-selected="false">Approvals</button><button class="x-tab" data-tab="d" aria-selected="false">Finance settings</button></div><p class="x-muted" id="xk-tab-out" style="margin-top:14px">Overview selected.</p></div>
         <div class="x-card" style="margin-top:16px"><ol class="x-timeline"><li class="is-done"><b>Signed</b>Deposit received</li><li class="is-done"><b>Engineering</b>Design approved</li><li class="is-now"><b>Production</b>Cutting</li><li><b>Quality check</b></li><li><b>Installation</b></li></ol></div>`),
      sec("people", "People", "Four avatar sizes instead of ten. The arch frames portraits; a lime ring means active now.",
        `<div class="x-card"><div class="xk-row" style="align-items:flex-end;gap:24px">
          <div style="text-align:center;font-size:12px" class="x-muted"><span class="x-avatar x-avatar--xs">AE</span><div>32</div></div>
          <div style="text-align:center;font-size:12px" class="x-muted"><span class="x-avatar is-live">AE</span><div>48 · active</div></div>
          <div style="text-align:center;font-size:12px" class="x-muted"><span class="x-avatar x-avatar--md" id="xk-av-md">AE</span><div>96</div></div>
          <div style="text-align:center;font-size:12px" class="x-muted"><span class="x-avatar x-avatar--md x-avatar--arch" id="xk-av-arch">AE</span><div>96 arch</div></div>
          <div class="x-avatars"><span class="x-avatar">MA</span><span class="x-avatar">SK</span><span class="x-avatar">+3</span></div>
        </div></div>
        <div class="xk-row" style="margin-top:24px;align-items:flex-start;gap:32px"><div id="xk-id"></div><div style="max-width:46ch"><h3 class="x-display x-d4" style="margin-bottom:8px">Your ID card (preview)</h3><p class="x-muted">Built from your own record: name, job title, employee ID and hire date as stored in X FORCE. Click or press Enter to flip. Session 5 places it on profiles and adds the printable PDF.</p></div></div>`),
      sec("states", "Empty, error and success", "One block glyph, one sentence, one real action.",
        `<div class="xk-grid" style="--_min:260px">
          <div class="x-card"><div class="x-state x-state--compact is-in"><div class="x-state__glyph"><i></i><i></i><i></i><i></i></div><h3>No production jobs yet</h3><p>Jobs appear here when an accepted order's measurements are verified.</p></div></div>
          <div class="x-card"><div class="x-state x-state--compact x-state--error is-in"><div class="x-state__glyph"><i></i><i></i><i></i><i></i></div><h3>Payments did not load</h3><p>The server did not answer. Your data is safe.</p><button class="x-btn x-btn--sm x-btn--primary">${ic("refresh", { size: "sm" })} Retry</button></div></div>
          <div class="x-card"><div class="x-state x-state--compact x-state--success is-in" id="xk-ok"><div class="x-state__glyph">${ic("check", { cls: "is-draw" })}</div><h3>Payment verified</h3><p>It now counts as collected cash.</p></div></div>
        </div>`),
      sec("notify", "Notifications", `Unread items carry a lime dot; urgent ones say so in words. ${EX}`,
        `<div class="x-card" style="padding:8px;max-width:560px"><div class="x-notif is-unread is-urgent">${mk("finance", { size: "sm" })}<div><div class="x-notif__t">Payment proof uploaded</div><div class="x-notif__b">[Order] · waiting for verification</div></div><span class="x-notif__time">2 min</span></div>
          <div class="x-notif is-unread">${mk("factory", { size: "sm" })}<div><div class="x-notif__t">Job moved to quality check</div><div class="x-notif__b">[Job] · [Engineer]</div></div><span class="x-notif__time">1 h</span></div>
          <div class="x-notif">${mk("sales", { size: "sm" })}<div><div class="x-notif__t">Follow-up due today</div><div class="x-notif__b">[Lead]</div></div><span class="x-notif__time">Yesterday</span></div></div>`),
      sec("nav", "Navigation", "The charcoal rail: a department switcher on top, lime pill for the current page.",
        `<div class="xk-nav x-on-deck"><div class="x-switcher" id="xk-sw">${["sales", "finance", "factory", "strategic"].map((d, i) => `<button type="button" data-d="${d}" aria-pressed="${i === 0}" title="${esc(XF.DEPT_LABEL[d])}">${mk(d, { label: "" })}<span>${esc(XF.DEPT_LABEL[d].split(" ")[0])}</span></button>`).join("")}</div>
          <div id="xk-navitems" style="display:flex;flex-direction:column;gap:2px;margin-top:10px"></div></div>`),
      sec("charts", "Charts", `Inline SVG in charcoal, stone and the page's one department colour. ${EX} — not X FORCE figures.`,
        `<div class="xk-grid" style="--_min:320px" data-x-dept="sales">
          <div class="x-card"><div class="x-card__h"><h3>Bars</h3></div><div id="xk-c1"></div></div>
          <div class="x-card"><div class="x-card__h"><h3>Line</h3></div><div id="xk-c2"></div></div>
          <div class="x-card"><div class="x-card__h"><h3>Share</h3></div><div id="xk-c3" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap"></div></div>
          <div class="x-card"><div class="x-card__h"><h3>Stage flow</h3><span id="xk-c5" style="margin-inline-start:auto"></span></div><div id="xk-c4"></div></div>
        </div>`),
    ].join("");
    bind(me);
  }

  function bind(me) {
    const V = $("#view-xfkit"), M = XF.motion;
    V.querySelectorAll("[data-tok]").forEach((s) => (s.textContent = getComputedStyle(document.documentElement).getPropertyValue(s.dataset.tok).trim()));
    // preview settings (page only)
    const seg = (id, fn) => { const box = $("#" + id); box.querySelectorAll("button").forEach((b) => (b.onclick = () => { box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); fn(b.dataset.v); })); };
    seg("xk-theme", (v) => { const h = document.documentElement; if (v) { h.dataset.theme = v; themeSet = true; } else { delete h.dataset.theme; themeSet = false; } V.querySelectorAll("[data-tok]").forEach((s) => (s.textContent = getComputedStyle(h).getPropertyValue(s.dataset.tok).trim())); });
    seg("xk-dir", (v) => { const k = $("#xk-body"); k.dir = v; k.lang = v === "rtl" ? "ar" : "en"; k.querySelectorAll("[data-ar]").forEach((e) => { e.dataset.en = e.dataset.en || e.textContent; e.textContent = v === "rtl" ? e.dataset.ar : e.dataset.en; }); });
    // motion demo
    V.querySelectorAll("[data-ease]").forEach((b) => (b.onclick = () => { const s = V.querySelector(`[data-track="${b.dataset.ease}"] .x-ball`); s.style.left = s.style.left ? "" : "calc(100% - 30px)"; }));
    // icons
    $("#xk-ring").onclick = (e) => XF.animateIcon(e.currentTarget, "ring");
    $("#xk-draw").onclick = (e) => { XF.animateIcon(e.currentTarget, "draw"); M.toast("Payment verified."); };
    $("#xk-turn").onclick = (e) => XF.animateIcon(e.currentTarget, "turn");
    V.querySelectorAll("[data-mark]").forEach((b) => (b.onclick = () => XF.animateIcon(b, "snap")));
    // buttons and fields
    $("#xk-busy").onclick = (e) => M.busy(e.currentTarget, () => new Promise((r) => setTimeout(r, 1200)));
    M.reveal($("#xk-pw"));
    $("#xk-inv input").oninput = (e) => $("#xk-inv").classList.toggle("is-invalid", !(+e.target.value > 0));
    // hero count-up, status
    V.querySelectorAll("#xk-hero [data-count]").forEach((n) => M.countUp(n, +n.dataset.count));
    const pills = [["x-pill--warn", "Awaiting verification"], ["x-pill--ok", "Verified"]]; let pi = 0;
    $("#xk-pill").onclick = () => { const p = V.querySelector("#xks-status .x-pill--warn, #xks-status .x-pill--ok"); if (!p) return; pi = 1 - pi; p.className = "x-pill " + pills[pi][0]; p.textContent = pills[pi][1]; M.play(p, "is-changed", 400); };
    // progress
    let bn = 0; const band = [...$("#xk-band").children];
    V.querySelectorAll("[data-band]").forEach((b) => (b.onclick = () => { bn = Math.max(0, Math.min(4, bn + +b.dataset.band)); band.forEach((x, i) => x.classList.toggle("is-on", i < bn)); }));
    $("#xk-range").oninput = (e) => { const v = +e.target.value; $("#xk-bar").style.setProperty("--_p", v + "%"); $("#xk-ring2").style.setProperty("--_p", v); $("#xk-ring2 b").textContent = v + "%"; };
    // loader demos (simulated timing, real component)
    const host = $("#xk-load"); let timer = 0;
    V.querySelectorAll("[data-load]").forEach((b) => (b.onclick = () => {
      clearInterval(timer); const k = b.dataset.load, screen = k === "screen";
      const job = XF.load.start({ target: screen ? "screen" : host, text: { wait: "Checking your account…", steps: "Loading your workspace", percent: "Uploading payment proof · 2.4 MB", timeout: "Generating proposal…", fail: "Loading payments…", screen: "Initializing X FORCE" }[k], timeoutMs: k === "timeout" ? 4000 : 60000, slowMs: k === "timeout" ? 2000 : 20000, steps: k === "steps" || screen ? 4 : 0, onRetry: k === "timeout" ? () => {} : null });
      if (k === "wait") setTimeout(() => job.done("Signed in."), 3000);
      if (k === "steps" || screen) { const s = ["Connecting to the server", "Checking your sign-in", "Loading the team directory", "Preparing your dashboard"]; let i = 0; job.step(0, s[0]); timer = setInterval(() => { i++; if (i < 4) job.step(i, s[i]); else { clearInterval(timer); job.done("Ready."); } }, 900); }
      if (k === "percent") { let got = 0; const tot = 2.4e6; timer = setInterval(() => { got = Math.min(tot, got + tot * (0.03 + Math.random() * 0.08)); job.progress(got, tot); if (got >= tot) { clearInterval(timer); job.done("Uploaded."); } }, 200); }
      if (k === "fail") setTimeout(() => job.fail("Payments did not load. The server answered 503. Nothing was changed.", { retry: () => setTimeout(() => job.done("Loaded."), 900) }), 1500);
    }));
    // feedback
    V.querySelectorAll("[data-toast]").forEach((b) => (b.onclick = () => { const k = b.dataset.toast; if (k === "ok") M.toast("Saved."); else if (k === "err") M.toast("Could not save. Check the connection and try again.", { kind: "err" }); else M.toast("Lead released.", { kind: "info", action: { label: "Undo", fn: () => M.toast("Lead restored.") } }); }));
    $("#xk-dlg-open").onclick = () => $("#xk-dlg").showModal();
    // tabs
    M.tabs($("#xk-tabs"), (k, t) => { const o = $("#xk-tab-out"); if (o) o.textContent = t.textContent + " selected."; });
    // nav
    const NAVI = { sales: [["dash", "Sales overview"], ["mine", "Lead Mine", 3], ["target", "My Leads"], ["phone", "Calls & follow-ups", 2], ["coins", "My Commission"]], finance: [["dash", "Finance overview"], ["shield", "Payment verification", 5], ["bank", "Financial accounts"], ["payroll", "Salaries & payroll"]], factory: [["dash", "Factory overview"], ["factory", "Production jobs", 1], ["truck", "Engineering orders"], ["gear", "Machines & tools"]], strategic: [["dash", "CEO Control Center"], ["globe", "Mission Control"], ["report", "Reports"], ["audit", "Audit log"]] };
    const navTo = (d) => { const box = $("#xk-navitems"); box.innerHTML = NAVI[d].map(([i, l, n], j) => `<button type="button" class="x-navi"${j === 0 ? ' aria-current="page"' : ""}>${ic(i)}<span>${esc(l)}</span>${n ? `<span class="x-count">${n}</span>` : ""}</button>`).join(""); box.querySelectorAll(".x-navi").forEach((b) => (b.onclick = () => { box.querySelectorAll(".x-navi").forEach((x) => x.removeAttribute("aria-current")); b.setAttribute("aria-current", "page"); })); };
    $("#xk-sw").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#xk-sw").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); navTo(b.dataset.d); }));
    navTo("sales");
    // charts (example data)
    XF.chart.bars($("#xk-c1"), [{ label: "Jun", value: 3 }, { label: "Jul", value: 5 }, { label: "Aug", value: 4 }, { label: "Sep", value: 7 }, { label: "Oct", value: 6, key: true }], { label: "Example: orders signed per month", showValues: true });
    XF.chart.line($("#xk-c2"), [12, 18, 15, 22, 26, 24, 31].map((v, i) => ({ label: "W" + (i + 1), value: v })), { label: "Example: weekly quotations" });
    XF.chart.donut($("#xk-c3"), [{ label: "Verified", value: 62 }, { label: "Awaiting", value: 25 }, { label: "Overdue", value: 13 }], { label: "Example: payments by state" });
    XF.chart.flow($("#xk-c4"), [{ label: "Lead", value: 18 }, { label: "Quotation", value: 9 }, { label: "Signed", value: 4, key: true }, { label: "Booked", value: 2 }]);
    XF.chart.spark($("#xk-c5"), [3, 5, 4, 7, 6]);
    // people: the signed-in administrator's own picture and ID card
    idPreview(me).catch((e) => console.warn("xfkit id", e));
  }

  async function idPreview(me) {
    const host = $("#xk-id"); if (!host) return;
    const uid = root.DPStore && DPStore.st.userId, rec = (root.DPAuth && DPAuth.A.record) || {};
    const [pic, staff] = await Promise.all([uid && root.DPAuth ? DPAuth.picture(uid).catch(() => null) : null, uid && root.DPSales ? DPSales.staffDoc(uid).catch(() => null) : null]);
    const hr = (staff && staff.hr) || {}, name = me.name || "Your name", initials = name.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
    const year = hr.hireDate ? String(hr.hireDate).slice(0, 4) : "—";
    const deptKey = { finance: "finance", accountant: "finance", engineer: "factory", marketing: "sales", employee: "sales", dataentry: "sales", admin: "strategic" }[U.role()] || "strategic";
    if (pic) ["#xk-av-md", "#xk-av-arch"].forEach((s) => { const a = $(s); if (a) a.innerHTML = `<img alt="" src="${esc(pic)}">`; });
    host.innerHTML = `<button type="button" class="x-idcard" data-name="${esc(name)}" style="--_w:340px">
      <div class="x-idcard__flip">
        <div class="x-idcard__face x-idcard__back">
          <span class="x-idcard__plate"><img src="brand/logo_compact.png" alt="Dupedia"></span>
          <div class="x-idcard__photo">${pic ? `<img alt="" src="${esc(pic)}">` : esc(initials)}</div>
          <p class="x-idcard__name">${esc(name)}</p>
          <p class="x-idcard__title">${esc([rec.title || me.title, rec.department || me.department].filter(Boolean).join(" · ") || me.roleLabel || "")}</p>
          <div class="x-idcard__row"><dl><div><dt>Employee ID</dt><dd>${esc(hr.employeeId || "—")}</dd></div><div><dt>Since</dt><dd>${esc(year)}</dd></div></dl>${XF.mark(deptKey)}</div>
        </div>
        <div class="x-idcard__face x-idcard__front"><img src="brand/logo_compact.png" alt="Dupedia"><p>Serious about play.</p></div>
      </div></button>`;
    XF.motion.idcard(host.firstElementChild);
  }

  // Theme preview never leaks out of the kit: reset it when another page opens.
  if (root.MutationObserver) root.addEventListener("DOMContentLoaded", () => { const a = document.getElementById("app"); if (a) new MutationObserver(() => { if (a.dataset.view !== "xfkit" && themeSet) { delete document.documentElement.dataset.theme; themeSet = false; } }).observe(a, { attributes: true, attributeFilter: ["data-view"] }); });
  U.register("xfkit", render);
})(typeof self !== "undefined" ? self : this);
