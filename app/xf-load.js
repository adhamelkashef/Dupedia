/* X FORCE 2.0 "Snap" — unified loader (Session 2).
   The logo stays still on its white plate (the brand: the logo never changes); the block band below it fills.
   Honesty rules, enforced here rather than left to each caller:
   • A percentage is shown ONLY from a measured loaded/total pair (bytes, rows). Without a total the loader falls back to a
     wait state. It never shows 100% before done() is called.
   • Known steps are shown as steps ("2 of 4"), never converted into a percentage.
   • "Still working" after 20 s without news, a timeout panel after 60 s without news (Retry / Keep waiting / Cancel),
     clear errors, and done() always hands over to the result — no loader can stay on screen forever. */
(function (root) {
  "use strict";
  const doc = root.document;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => !!(root.XF && root.XF.motion && root.XF.motion.reduced());
  const LOGO = "brand/logo_compact.png";   // brand: the primary logo (with ESTD 1989) only from 400 px wide; the compact one below that
  const T = { slow: "Still working. This is taking longer than usual.", timeout: "No answer for 60 seconds. It may still finish in the background.", retry: "Retry", wait: "Keep waiting", cancel: "Cancel", close: "Close" };

  /**
   * Start a loader.
   * opts: {
   *   target: "screen" (full screen, default) | an element to fill (inline),
   *   text: status line, sub: optional second line,
   *   steps: number of known steps (enables step mode),
   *   slowMs: 20000, timeoutMs: 60000,
   *   onRetry: fn (shows Retry), onCancel: fn (shows Cancel), logo: true
   * }
   * Returns a job: { text, step, progress, done, fail, close, el }.
   */
  function start(opts = {}) {
    const screen = !opts.target || opts.target === "screen";
    const el = doc.createElement("div");
    el.className = "x-loader " + (screen ? "x-loader--screen" : "x-loader--inline");
    el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    el.innerHTML = `${opts.logo === false || !screen ? "" : `<span class="x-loader__plate"><img src="${LOGO}" alt="Dupedia" width="240" height="124"></span>`}
      <div class="x-band x-band--wait" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="x-loader__pct x-num" hidden></div>
      <div class="x-bar" hidden><b></b></div>
      <p class="x-loader__text"></p><p class="x-loader__sub"></p>
      <div class="x-loader__acts" hidden></div>`;
    const $ = (s) => el.querySelector(s), band = $(".x-band"), blocks = [...band.children], pct = $(".x-loader__pct"), bar = $(".x-bar"), txt = $(".x-loader__text"), sub = $(".x-loader__sub"), acts = $(".x-loader__acts");
    if (screen) doc.body.appendChild(el); else { opts.target.innerHTML = ""; opts.target.appendChild(el); }

    const st = { mode: opts.steps ? "steps" : "wait", total: opts.steps || 0, finished: false, last: Date.now(), slowT: 0, outT: 0, base: opts.text || "Loading…" };
    const fill = (n) => { blocks.forEach((b, i) => b.classList.toggle("is-on", i < n)); };
    const setWait = (on) => { band.classList.toggle("x-band--wait", on); if (on) fill(0); };
    function arm() {   // (re)start the "still working" and timeout clocks from the last sign of progress
      clearTimeout(st.slowT); clearTimeout(st.outT); st.last = Date.now(); sub.textContent = sub.dataset.keep || "";
      st.slowT = setTimeout(() => { if (!st.finished) sub.textContent = T.slow; }, opts.slowMs || 20000);
      st.outT = setTimeout(timeout, opts.timeoutMs || 60000);
    }
    function buttons(list) { acts.hidden = !list.length; acts.innerHTML = ""; list.forEach(([label, cls, fn]) => { const b = doc.createElement("button"); b.type = "button"; b.className = "x-btn " + cls; b.textContent = label; b.onclick = fn; acts.appendChild(b); }); const f = acts.querySelector("button"); f && f.focus(); }
    function timeout() {
      if (st.finished) return; el.classList.add("is-error"); setWait(false); txt.textContent = T.timeout;
      const list = [];
      if (opts.onRetry) list.push([T.retry, "x-btn--primary", () => { reset(); opts.onRetry(job); }]);
      list.push([T.wait, opts.onRetry ? "x-btn--ghost" : "x-btn--primary", () => { el.classList.remove("is-error"); buttons([]); txt.textContent = st.base; if (st.mode === "wait") setWait(true); arm(); }]);
      if (opts.onCancel) list.push([T.cancel, "x-btn--ghost", () => { opts.onCancel(job); close(); }]);
      buttons(list);
    }
    function reset() { el.classList.remove("is-error", "is-done"); buttons([]); st.finished = false; txt.textContent = st.base; pct.hidden = true; bar.hidden = true; st.mode = opts.steps ? "steps" : "wait"; setWait(true); arm(); }

    const job = {
      el,
      /** Change the status line (counts as a sign of life). */
      text(t, s) { st.base = t; txt.textContent = t; if (s !== undefined) { sub.dataset.keep = s || ""; sub.textContent = s || ""; } arm(); return job; },
      /** Step mode: i = the step now running (0-based), label = what it is doing. Blocks fill by completed steps. */
      step(i, label) {
        if (st.finished) return job; st.mode = "steps"; st.total = st.total || opts.steps || 1; setWait(false);
        const done = Math.max(0, Math.min(st.total, i)); fill(Math.round((done / st.total) * 4));
        st.base = (label || st.base); txt.textContent = `${st.base} · ${Math.min(st.total, i + 1)} of ${st.total}`; arm(); return job;
      },
      /** Measured progress: loaded and total in the same unit (bytes, rows). Without a usable total it stays a wait. */
      progress(loaded, total, label) {
        if (st.finished) return job; if (label) { st.base = label; txt.textContent = label; }
        if (!(total > 0) || !(loaded >= 0)) { st.mode = "wait"; pct.hidden = true; bar.hidden = true; setWait(true); arm(); return job; }
        st.mode = "percent"; setWait(false);
        const p = Math.min(99, Math.floor((loaded / total) * 100));   // 100% is reserved for done()
        pct.hidden = false; pct.textContent = p + "%"; bar.hidden = false; bar.style.setProperty("--_p", p + "%"); fill(Math.floor(p / 25)); arm(); return job;
      },
      /** Finished: fill, say so briefly, then hand over (full-screen loaders fade out; inline ones are removed). */
      done(label, { holdMs = 450 } = {}) {
        if (st.finished) return Promise.resolve(); st.finished = true; clearTimeout(st.slowT); clearTimeout(st.outT);
        el.classList.add("is-done"); setWait(false); fill(4); buttons([]); sub.textContent = "";
        if (st.mode === "percent") { pct.textContent = "100%"; bar.style.setProperty("--_p", "100%"); }
        if (label) txt.textContent = label;
        return new Promise((res) => setTimeout(() => { close(); res(); }, reduced() ? 0 : holdMs));
      },
      /** Failed: a clear message and, when the caller can retry, a Retry button. The loader stays until the user acts. */
      fail(message, { retry = opts.onRetry } = {}) {
        st.finished = true; clearTimeout(st.slowT); clearTimeout(st.outT); el.classList.add("is-error"); setWait(false);
        txt.textContent = message || "Something went wrong."; sub.textContent = "";
        buttons([].concat(retry ? [[T.retry, "x-btn--primary", () => { reset(); retry(job); }]] : [], [[T.close, retry ? "x-btn--ghost" : "x-btn--primary", close]]));
        return job;
      },
      close,
    };
    function close() {
      st.finished = true; clearTimeout(st.slowT); clearTimeout(st.outT); if (!el.isConnected) return;
      if (screen && !reduced()) { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 320); } else el.remove();
    }
    job.text(opts.text || "Loading…", opts.sub);
    return job;
  }

  /** Run an async function behind a loader. fn(job) may report steps or progress. Errors show in the loader (with Retry when
      `retry: true`) and are re-thrown to the caller. */
  async function track(fn, opts = {}) {
    let job;
    const run = async () => {
      try { const r = await fn(job); await job.done(opts.doneText); return r; }
      catch (e) { job.fail((e && e.message) || "Something went wrong.", opts.retry ? { retry: () => run().catch(() => {}) } : {}); throw e; }
    };
    job = start(opts);
    return run();
  }

  /** Upload with real byte progress (XMLHttpRequest, same-origin cookies). body: FormData | Blob | string.
      Reports to opts.job (a loader) and/or opts.onProgress(loaded, total). Resolves { status, ok, data }. */
  function upload(url, body, opts = {}) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); x.open(opts.method || "POST", url); x.withCredentials = true;
      Object.entries(opts.headers || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
      x.upload.onprogress = (e) => { const t = e.lengthComputable ? e.total : 0; opts.job && opts.job.progress(e.loaded, t); opts.onProgress && opts.onProgress(e.loaded, t); };
      x.onload = () => { let data = x.responseText; try { data = JSON.parse(x.responseText); } catch (e) {} resolve({ status: x.status, ok: x.status >= 200 && x.status < 300, data }); };
      x.onerror = () => reject(new Error("The upload could not reach the server. Check the connection and try again."));
      x.onabort = () => reject(new Error("The upload was cancelled."));
      if (opts.signal) opts.signal.addEventListener("abort", () => x.abort());
      x.send(body);
    });
  }

  /** Download with real progress when the server sends Content-Length; otherwise a wait state. Resolves a Blob. */
  async function download(url, opts = {}) {
    const r = await fetch(url, { credentials: "same-origin", signal: opts.signal });
    if (!r.ok) throw new Error(`The server answered ${r.status}.`);
    const total = +r.headers.get("content-length") || 0;
    if (!r.body || !r.body.getReader) { opts.job && opts.job.progress(0, 0); return r.blob(); }
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; opts.job && opts.job.progress(got, total); opts.onProgress && opts.onProgress(got, total); }
    return new Blob(parts, { type: r.headers.get("content-type") || "" });
  }

  /** Progress for one file being stored (DPOrders.putFile). Shown as a small panel in the corner, so every upload screen gets it.
      total and progress() are in the same unit (characters of the stored file, which the server confirms piece by piece).
      Quick uploads (under 400 ms) never show; 100% only appears after the read-back check passes (done()). */
  /** The corner toast stack, raised into the top layer (popover) so it shows above open dialogs too. */
  function toastBox() {
    let box = doc.querySelector(".x-toasts"); if (!box) { box = doc.createElement("div"); box.className = "x-toasts"; box.setAttribute("aria-live", "polite"); if ("popover" in box) box.popover = "manual"; doc.body.appendChild(box); }
    try { if (box.showPopover) { if (box.matches(":popover-open")) box.hidePopover(); box.showPopover(); } } catch (e) {}
    return box;
  }
  function fileProgress(name, total) {
    let el = null, p = 0, over = false;
    const show = () => {
      if (over || el) return;
      const box = toastBox();
      el = doc.createElement("div"); el.className = "x-toast x-toast--progress"; el.setAttribute("role", "status");
      el.innerHTML = `<span class="x-ball x-ball--info"></span><span class="x-toast__name">Uploading ${esc(name || "file")}</span><b class="x-num">${p}%</b><div class="x-bar"><b style="--_p:${p}%"></b></div>`;
      box.appendChild(el);
    };
    const timer = setTimeout(show, 400);
    const leave = (ms) => setTimeout(() => { if (!el) return; if (reduced()) return el.remove(); el.classList.add("is-leaving"); setTimeout(() => el && el.remove(), 220); }, ms);
    return {
      progress(sent) { if (over || !(total > 0)) return; p = Math.min(99, Math.floor((sent / total) * 100)); if (el) { el.querySelector("b.x-num").textContent = p + "%"; el.querySelector(".x-bar>b").style.setProperty("--_p", p + "%"); } },
      done() { over = true; clearTimeout(timer); if (!el) return; el.querySelector(".x-ball").className = "x-ball x-ball--ok"; el.querySelector(".x-toast__name").textContent = `Uploaded ${name || "file"}`; el.querySelector("b.x-num").textContent = "100%"; el.querySelector(".x-bar>b").style.setProperty("--_p", "100%"); leave(1400); },
      fail(msg) { over = true; clearTimeout(timer); if (!el) return; el.querySelector(".x-ball").className = "x-ball x-ball--err"; el.querySelector(".x-toast__name").textContent = `${name || "The file"} did not upload. Check the connection and attach it again.`; el.querySelector(".x-toast__name").style.whiteSpace = "normal"; el.querySelector("b.x-num").textContent = ""; el.querySelector(".x-bar").remove(); leave(6000); },
    };
  }

  const XF = (root.XF = root.XF || {});
  XF.load = { start, track, upload, download, fileProgress, toastBox };
})(typeof self !== "undefined" ? self : this);
