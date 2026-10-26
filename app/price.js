/* Dupedia Site Planner 2.2 — price-book distribution.
   The master price book (config/pricebook) and commission rule (config/commission) are readable by administrators only.
   Each active sales employee gets a copy written by an administrator at pb/<uid>, which only that person can read.
   Engineers and data entry staff get no copy, so the database never returns selling prices to them. */
(function (root) {
  "use strict";
  const DS = () => root.DPStore, AU = () => root.DPAuth;
  /** Rewrite every sales employee's copy (administrators). Called after saving prices, the commission rule or users. */
  async function syncCopies() {
    if (!AU().isAdmin()) return { written: 0 };
    const [pb, com, dir] = await Promise.all([DS().tryGet("config/pricebook"), DS().tryGet("config/commission"), AU().listDirectory()]);
    const cfg = com && Array.isArray(com.versions) && com.versions.length ? com : { current: "C1", versions: [root.DPCommission.DEFAULT_RULE], trigger: "approval" };
    const rule = cfg.versions.find((v) => v.id === cfg.current) || cfg.versions[cfg.versions.length - 1];
    const doc = { pricebook: pb || { currency: "EGP", items: {} }, commission: { current: rule.id, versions: [rule], trigger: cfg.trigger }, at: new Date().toISOString() };
    let written = 0;
    for (const r of dir) {
      if (!r.uid) continue;
      const sales = r.active !== false && AU().baseOf(r.role) === "employee";
      if (sales) { await DS().set(`pb/${r.uid}`, doc); written++; }
      else if (await DS().tryGet(`pb/${r.uid}`)) await DS().del(`pb/${r.uid}`);
    }
    return { written };
  }
  /** What this person may read: administrators the master, sales their copy, everyone else nothing. */
  async function load() {
    const me = AU().A.me || {};
    if (me.role === "admin") return { pricebook: await DS().tryGet("config/pricebook"), commission: await DS().tryGet("config/commission") };
    if (me.role === "employee") { const c = await DS().tryGet(`pb/${me.id}`); return { pricebook: c && c.pricebook, commission: c && c.commission }; }
    return { pricebook: null, commission: null };
  }
  root.DPPrice = { syncCopies, load };
})(typeof self !== "undefined" ? self : this);
