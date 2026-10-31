/* X FORCE 1.4.3 — interface layer: department identity, "Search or jump to…" palette (Ctrl/⌘ K), grouped navigation
   that remembers what you folded, the phone menu, and remembered open/closed dashboard sections.
   Presentation only: it reads what the navigation already offers the signed-in person and clicks the same buttons, so
   permissions, routes and saving rules stay exactly where they were. */
/* global DPUI */
(function (root) {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k, d) { try { const v = localStorage.getItem("xf.ui." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("xf.ui." + k, JSON.stringify(v)); } catch (e) {} } };

  /* ---------- departments: one signal colour per surface ---------- */
  const DEPT = {
    strategic: ["mission", "intel", "reports", "search", "askceo", "workforce", "audit"],
    sales: ["leads", "myleads", "allleads", "research", "calls", "proposals", "register", "approvals", "mycomm", "commadmin", "growth", "campaigns", "radar", "partners", "tracking"],
    finance: ["finance", "transfers", "finaccounts", "salaries", "purchases", "invoices", "taxes", "finreports", "payverify", "approvecomm"],
    ops: ["engorders", "engqueue", "factory", "workers", "facjobs", "facdash", "equipment", "holidays"],
    studio: ["start", "home", "setup", "plan", "quote", "review", "proposal", "catalog", "products"],
  };
  const deptOf = (v) => { if (v === "dash") return root.DPUI && DPUI.isAdmin && DPUI.isAdmin() ? "strategic" : "neutral"; for (const k in DEPT) if (DEPT[k].includes(v)) return k; return "neutral"; };
  const GROUP_DEPT = { "factory & products": "ops", "growth & marketing": "sales", finance: "finance", administration: "strategic" };

  function syncDept() { const a = $("#app"); if (!a) return; const v = a.dataset.view || "dash"; a.dataset.dept = deptOf(v); remember(v); }
  function remember(v) { if (!v || v === "dash") return; const r = store.get("recent", []).filter((x) => x !== v); r.unshift(v); store.set("recent", r.slice(0, 5)); }

  /* ---------- navigation groups (fold / unfold, remembered) ---------- */
  function enhanceRail() {
    const rail = $("#rail"); if (!rail || rail.dataset.xd === rail.innerHTML.length + ":" + ($(".ri.is-on", rail) || {}).dataset?.nav) return;
    const folded = store.get("folded", {});
    $$(".rh", rail).forEach((h) => {
      const g = h.nextElementSibling; if (!g || !g.classList.contains("rg")) return;
      const key = h.textContent.trim().toLowerCase(); h.dataset.dept = GROUP_DEPT[key] || "neutral";
      const hasOn = !!$(".ri.is-on", g), shut = !!folded[key] && !hasOn;
      h.setAttribute("role", "button"); h.tabIndex = 0; h.setAttribute("aria-expanded", shut ? "false" : "true"); g.classList.toggle("xfold", shut);
      const toggle = () => { const open = g.classList.toggle("xfold") === false; h.setAttribute("aria-expanded", open ? "true" : "false"); const f = store.get("folded", {}); f[key] = !open; store.set("folded", f); };
      h.onclick = toggle; h.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
    });
    // phone: the first four places stay in the bar, everything else is one tap away under "Menu"
    if (!$(".xmore", rail)) {
      const b = document.createElement("button"); b.type = "button"; b.className = "ri xmore"; b.setAttribute("aria-label", "Open the full menu");
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menu</span>`;
      b.onclick = () => sheet(!$("#app").classList.contains("xsheet"));
      const first = $(".rg", rail); if (first) { first.classList.add("xprim"); first.appendChild(b); }
    }
    $$("[data-nav]", rail).forEach((b) => b.addEventListener("click", () => sheet(false)));
    rail.dataset.xd = rail.innerHTML.length + ":" + ($(".ri.is-on", rail) || {}).dataset?.nav;
  }
  function sheet(on) { const a = $("#app"); if (!a) return; a.classList.toggle("xsheet", !!on); const b = $(".xmore"); if (b) { b.setAttribute("aria-expanded", on ? "true" : "false"); const t = $("span", b); if (t) t.textContent = on ? "Close" : "Menu"; } }

  /* ---------- Search or jump to… ---------- */
  const P = { el: null, items: [], sel: 0 };
  function entries(q) {
    const rail = $("#rail"); if (!rail) return [];
    const navs = $$("[data-nav]", rail).map((b) => ({ kind: "page", key: b.dataset.nav, label: ($("span", b) || b).textContent.trim(), icon: ($("svg", b) || {}).outerHTML || "", group: groupOf(b), run: () => b.click() }));
    const seen = new Set(), uniq = navs.filter((x) => (seen.has(x.key) ? false : seen.add(x.key)));
    const t = q.trim().toLowerCase();
    let out;
    if (!t) {
      const rec = store.get("recent", []).map((k) => uniq.find((x) => x.key === k)).filter(Boolean).map((x) => Object.assign({}, x, { group: "Recent" }));
      out = rec.concat(uniq.filter((x) => !rec.some((r) => r.key === x.key)));
    } else {
      const words = t.split(/\s+/);
      out = uniq.map((x) => { const l = (x.label + " " + x.group).toLowerCase(); if (!words.every((w) => l.includes(w))) return null; return Object.assign({ score: x.label.toLowerCase().startsWith(t) ? 0 : x.label.toLowerCase().includes(t) ? 1 : 2 }, x); })
        .filter(Boolean).sort((a, b) => a.score - b.score);
      if (uniq.some((x) => x.key === "search")) out.push({ kind: "act", key: "search", label: `Search customers, leads, orders and people for “${q.trim()}”`, icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>`, group: "Company search", run: () => DPUI.go("search", { q: q.trim() }) });
    }
    const out2 = $("#r-out"); if (out2 && (!t || "sign out log out".includes(t))) out.push({ kind: "act", key: "out", label: "Sign out", icon: ($("svg", out2) || {}).outerHTML || "", group: "Account", run: () => out2.click() });
    return out.slice(0, 40);
  }
  function groupOf(b) { const g = b.closest(".rg"); let h = g && g.previousElementSibling; return h && h.classList.contains("rh") ? h.textContent.trim() : "My work"; }
  function openPalette() {
    if (!$("#app") || $("#app").hidden) return;
    if (!P.el) {
      P.el = document.createElement("dialog"); P.el.className = "xpal"; P.el.setAttribute("aria-label", "Search or jump to a page");
      P.el.innerHTML = `<div class="xpal-in"><label class="xpal-q"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg><input id="xpal-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search or jump to a page…" role="combobox" aria-expanded="true" aria-controls="xpal-l" aria-autocomplete="list"><kbd>Esc</kbd></label>
        <div class="xpal-l" id="xpal-l" role="listbox"></div><p class="xpal-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd> anytime</span></p></div>`;
      document.body.appendChild(P.el);
      const q = $("#xpal-q", P.el);
      q.oninput = () => { P.sel = 0; draw(q.value); };
      q.onkeydown = (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); P.sel = Math.max(0, Math.min(P.items.length - 1, P.sel + (e.key === "ArrowDown" ? 1 : -1))); mark(); }
        else if (e.key === "Enter") { e.preventDefault(); pick(P.sel); }
        else if (e.key === "Escape") { e.preventDefault(); P.el.close(); }   // a search box would only clear itself
      };
      P.el.addEventListener("click", (e) => { if (e.target === P.el) P.el.close(); });
    }
    const q = $("#xpal-q", P.el); q.value = ""; P.sel = 0; draw("");
    if (!P.el.open) P.el.showModal(); q.focus();
  }
  function draw(q) {
    P.items = entries(q); const L = $("#xpal-l", P.el); let g = null;
    L.innerHTML = P.items.length ? P.items.map((x, i) => `${x.group !== g ? `<div class="xpal-g" role="presentation">${esc((g = x.group))}</div>` : ""}<button type="button" class="xpal-i" role="option" id="xpo-${i}" data-i="${i}">${x.icon}<span>${esc(x.label)}</span></button>`).join("")
      : `<p class="xpal-none">Nothing matches “${esc(q)}”. Try a page name such as “leads” or “finance”.</p>`;
    $$(".xpal-i", L).forEach((b) => { b.onclick = () => pick(+b.dataset.i); b.onmousemove = () => { if (P.sel !== +b.dataset.i) { P.sel = +b.dataset.i; mark(); } }; });
    mark();
  }
  function mark() { $$(".xpal-i", P.el).forEach((b) => b.setAttribute("aria-selected", +b.dataset.i === P.sel ? "true" : "false")); const on = $(`#xpo-${P.sel}`, P.el); if (on) { on.scrollIntoView({ block: "nearest" }); $("#xpal-q", P.el).setAttribute("aria-activedescendant", on.id); } }
  function pick(i) { const x = P.items[i]; if (!x) return; P.el.close(); x.run(); }

  /* ---------- remembered disclosure for dashboard sections ---------- */
  const openOf = (k, def) => { const s = store.get("sect", {}); return k in s ? !!s[k] : def; };
  document.addEventListener("toggle", (e) => { const d = e.target; if (d && d.matches && d.matches("details.xsect[data-k]")) { const s = store.get("sect", {}); s[d.dataset.k] = d.open; store.set("sect", s); } }, true);

  /* ---------- wiring ---------- */
  function boot() {
    const app = $("#app"); if (!app) return;
    new MutationObserver(syncDept).observe(app, { attributes: true, attributeFilter: ["data-view", "hidden"] }); syncDept();
    const rail = $("#rail"); if (rail) new MutationObserver(enhanceRail).observe(rail, { childList: true });
    const btn = $("#xf-cmd"); if (btn) btn.onclick = openPalette;
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); if (P.el && P.el.open) P.el.close(); else openPalette(); }
      else if (e.key === "Escape" && app.classList.contains("xsheet")) sheet(false);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  root.DPX = { deptOf, openPalette, openOf, sheet };
})(typeof self !== "undefined" ? self : this);
