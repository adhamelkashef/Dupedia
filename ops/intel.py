#!/usr/bin/env python3
"""X FORCE 1.1 (Dupedia) — Market Intelligence ingest. Validates, de-duplicates, scores and stores research results.

The research itself (web searches, reading sources) is done by the scheduled Claude task; this script is the
deterministic gate between what was found and what is stored. It never invents data: anything without a source is
dropped or labelled unverified, and the output lists exactly which documents to write.

Usage:  python3 -I intel.py <job> <dump_dir> <candidates.json> [now_iso]
  job          opportunities | news | fx | materials | weekly
  dump_dir     ArtifactData dump (out_dir) of: mi/opps/o, mix/news/n, mix/fx/r, mix/mat/m, mix/reports/w, directory, mi/state/jobs
  candidates   JSON written by the research session (shape per job, see README / prompt)
Prints JSON {writes:[{collection, doc_id, data}], notes:[...], stats:{...}}. Writes nothing itself.
"""
import glob, hashlib, json, os, re, sys, unicodedata
from datetime import datetime, timedelta, timezone

JOBS = {"opportunities": "Daily Opportunity Discovery", "news": "Market News Monitor", "fx": "Currency Update",
        "materials": "Material-Price Update", "weekly": "Weekly Market Position Report"}
CURRENCIES = ["USD", "CNY", "EUR", "AED", "GBP"]
CATEGORIES = ["developer", "compound", "school", "nursery", "hotel", "resort", "coastal", "club", "fec", "amusement", "waterpark",
              "public", "landscape", "mall", "hospitality", "tender", "partner", "distributor", "oem", "exhibition", "association",
              "supplier", "media", "competitor", "trend", "procurement", "supply", "other"]
KINDS = ["project", "tender", "partnership", "market", "competitor"]
TARGET_AREAS = ["new cairo", "new zayed", "sheikh zayed", "north coast", "sahel", "alamein", "ain sokhna", "sokhna", "6th of october",
                "october", "new capital", "administrative capital", "mostakbal", "ras el hekma", "galala", "hurghada", "el gouna",
                "sharm", "red sea", "madinaty", "shorouk"]
EGYPT = ["egypt", "cairo", "giza", "alexandria", "matrouh", "suez", "ismailia", "luxor", "aswan"] + TARGET_AREAS
NEAR = ["saudi", "ksa", "riyadh", "jeddah", "uae", "dubai", "abu dhabi", "qatar", "doha", "kuwait", "oman", "bahrain", "jordan", "libya", "morocco", "iraq"]
PRODUCT_WORDS = {"play": 6, "playground": 8, "kids": 4, "children": 4, "family": 3, "amusement": 6, "water park": 7, "aqua": 5,
                 "entertainment": 5, "soft play": 7, "park": 3, "landscape": 4, "garden": 2, "beach": 4, "resort": 3, "school": 4,
                 "nursery": 5, "kindergarten": 5, "club": 3, "mall": 3, "compound": 4, "furniture": 3, "bench": 3, "shade": 2,
                 "sports": 3, "recreation": 5, "leisure": 4, "theme park": 7, "fec": 5, "arcade": 5}
OFFICIAL = [r"\.gov\.eg$", r"\.gov$", r"\.gov\.[a-z]{2}$", r"(^|\.)etenders\.gov\.eg$", r"(^|\.)cbe\.org\.eg$", r"(^|\.)customs\.gov\.eg$",
            r"(^|\.)mof\.gov\.eg$", r"(^|\.)gafi\.gov\.eg$", r"(^|\.)nuca\.gov\.eg$", r"(^|\.)egx\.com\.eg$", r"(^|\.)sis\.gov\.eg$"]
REPUTABLE = ["reuters.com", "bloomberg.com", "ahram.org.eg", "english.ahram.org.eg", "dailynewsegypt.com", "egypttoday.com", "enterprise.press",
             "zawya.com", "arabnews.com", "thenationalnews.com", "ft.com", "wsj.com", "apnews.com", "bbc.com", "cnbcarabia.com", "amwalalghad.com",
             "almalnews.com", "youm7.com", "masrawy.com", "elwatannews.com", "shorouknews.com", "investing.com", "xe.com", "construction-week",
             "constructionweekonline.com", "propertyfinder.eg", "aqarmap.com.eg", "lloydslist.com", "joc.com", "freightos.com", "drewry.co.uk",
             "spglobal.com", "fastmarkets.com", "argusmedia.com", "steelorbis.com", "worldbank.org", "imf.org"]


def now_utc(arg=None):
    if arg:
        return datetime.fromisoformat(arg.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def docs(root, coll):
    out = {}
    for p in glob.glob(os.path.join(root, *coll.split("/"), "*.json")):
        d = load(p)
        if isinstance(d, dict):
            out[os.path.splitext(os.path.basename(p))[0]] = d
    return out


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(the|a|an|of|for|and|in|at|by|project|new|company|co|ltd|s\.a\.e|sae|llc|group|developments?)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tokens(s):
    return set(t for t in norm(s).split() if len(t) > 2)


def jacc(a, b):
    a, b = tokens(a), tokens(b)
    return len(a & b) / max(1, len(a | b))


def host(url):
    m = re.match(r"^https?://([^/:?#]+)", str(url or "").strip(), re.I)
    return re.sub(r"^www\.", "", m.group(1).lower()) if m else None


def good_url(url):
    return bool(host(url)) and len(str(url)) <= 2000


def parse_date(s):
    if not s:
        return None
    s = str(s).strip()
    if re.fullmatch(r"\d{4}-\d{2}", s):
        s += "-01"
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def source_class(url, declared=None):
    h = host(url) or ""
    if any(re.search(p, h) for p in OFFICIAL):
        return "official"
    if declared == "organization":
        return "organization"
    if any(h == r or h.endswith("." + r) or r in h for r in REPUTABLE):
        return "reputable"
    return "other"


def sid(*parts):
    return hashlib.sha1("|".join(norm(p) for p in parts).encode()).hexdigest()[:16]


def job_doc(job, now, ok, created=0, updated=0, notes=None, error=None, prev=None, schedule=None):
    prev = prev or {}
    d = {"job": job, "label": JOBS.get(job, job), "lastAttempt": iso(now), "status": "ok" if ok else "failed", "schedule": schedule or "manual",
         "lastSuccess": iso(now) if ok else prev.get("lastSuccess"), "created": created, "updated": updated,
         "notes": (notes or [])[:20], "error": error, "runs": int(prev.get("runs") or 0) + 1,
         "failures": 0 if ok else int(prev.get("failures") or 0) + 1}
    return d


# ---------------------------------------------------------------- opportunities
def score_opp(o, now):
    """Explainable 0–100 score. Each part carries its reason. Not a probability of winning."""
    text = " ".join([o.get("title", ""), o.get("description", ""), o.get("organization", ""), " ".join(o.get("products") or [])]).lower()
    loc = (o.get("location") or "").lower()
    parts = []

    def add(k, label, pts, mx, why):
        parts.append({"k": k, "label": label, "pts": int(max(0, min(mx, round(pts)))), "max": mx, "why": why})
    fit = sum(v for w, v in PRODUCT_WORDS.items() if w in text)
    add("fit", "Product fit", min(20, fit + 3 * len(o.get("products") or [])), 20,
        f"Mentions {', '.join(sorted(w for w in PRODUCT_WORDS if w in text)[:5]) or 'no play/leisure terms'}; {len(o.get('products') or [])} Dupedia product line(s) suggested")
    cat = o.get("category") or "other"
    rel = {"compound": 15, "developer": 14, "resort": 14, "hotel": 12, "school": 13, "nursery": 12, "fec": 15, "amusement": 15, "waterpark": 15,
           "mall": 12, "club": 12, "public": 11, "landscape": 11, "coastal": 14, "hospitality": 11, "tender": 13}.get(cat, 6)
    add("customer", "Customer relevance", rel, 15, f"Customer category: {cat}")
    v = (o.get("estValue") or {}).get("amountEgp")
    big = any(w in text for w in ["compound", "resort", "mall", "theme park", "water park", "city", "district", "master plan", "masterplan", "km", "feddan", "acres"])
    if v:
        sc, why = (15, "estimated value ≥ EGP 50M") if v >= 50e6 else (11, "estimated value ≥ EGP 10M") if v >= 10e6 else (7, "estimated value < EGP 10M")
    else:
        sc, why = (9, "large-scale development by its description (value not published)") if big else (4, "scale unknown")
    add("scale", "Project scale", sc, 15, why)
    if any(a in loc for a in TARGET_AREAS):
        add("geo", "Geographic relevance", 10, 10, "Priority sales area")
    elif any(a in loc for a in EGYPT):
        add("geo", "Geographic relevance", 7, 10, "Egypt, outside the priority areas")
    elif any(a in loc for a in NEAR):
        add("geo", "Geographic relevance", 4, 10, "Nearby export market")
    else:
        add("geo", "Geographic relevance", 1, 10, "Location unclear or far")
    sc_cls = source_class(o.get("sourceUrl"), o.get("sourceType"))
    add("source", "Source reliability", {"official": 10, "organization": 8, "reputable": 7, "other": 3}[sc_cls], 10, f"Source class: {sc_cls} ({host(o.get('sourceUrl'))})")
    pub = parse_date(o.get("publishedAt"))
    if pub:
        age = (now - pub).days
        add("recency", "Recency", 10 if age <= 14 else 7 if age <= 45 else 4 if age <= 120 else 1, 10, f"Published {age} day(s) ago")
    else:
        add("recency", "Recency", 2, 10, "Publication date unknown")
    contact = o.get("contact") or {}
    add("contact", "Ability to contact", 5 if contact.get("text") and contact.get("sourceUrl") else 3 if o.get("orgWebsite") else 1, 5,
        "Published contact route" if contact.get("text") else "Organisation website known" if o.get("orgWebsite") else "No contact route found yet")
    supply = 5 if fit >= 10 else 3 if fit >= 5 else 1
    add("supply", "Dupedia can supply", supply, 5, "Core playground/leisure scope" if supply == 5 else "Partial fit" if supply == 3 else "Weak fit")
    dl = parse_date((o.get("deadline") or {}).get("date"))
    if dl:
        days = (dl - now).days
        add("urgency", "Competitive urgency", 5 if 0 <= days <= 30 else 3 if 0 <= days <= 90 else 0, 5, f"Deadline in {days} day(s)" if days >= 0 else "Deadline passed")
    else:
        add("urgency", "Competitive urgency", 2 if o.get("kind") in ("tender", "project") else 1, 5, "No published deadline")
    commercial = 5 if (v and v >= 10e6) or big else 3 if rel >= 12 else 1
    add("commercial", "Commercial potential", commercial, 5, "Large or repeat-business potential" if commercial == 5 else "Typical project size" if commercial == 3 else "Limited")
    return sum(p["pts"] for p in parts), parts


def ingest_opps(root, cands, now, notes):
    existing = docs(root, "mi/opps/o")
    writes, created, updated = [], 0, 0
    seen_keys = {}
    for k, d in existing.items():
        seen_keys[k] = d
    for i, c in enumerate(cands if isinstance(cands, list) else []):
        title = str(c.get("title") or "").strip()[:200]
        url = str(c.get("sourceUrl") or "").strip()
        if not title or not good_url(url):
            notes.append(f"#{i}: dropped — no title or no valid source URL")
            continue
        o = {"title": title, "organization": str(c.get("organization") or "").strip()[:160], "location": str(c.get("location") or "").strip()[:160],
             "category": c.get("category") if c.get("category") in CATEGORIES else "other", "kind": c.get("kind") if c.get("kind") in KINDS else "project",
             "description": str(c.get("description") or "").strip()[:1500], "products": [str(x)[:60] for x in (c.get("products") or [])][:8],
             "sourceUrl": url, "sourceOrg": str(c.get("sourceOrg") or host(url) or "")[:120], "sourceType": c.get("sourceType") if c.get("sourceType") in ("official", "organization", "media", "industry", "other") else None,
             "publishedAt": (parse_date(c.get("publishedAt")) and parse_date(c.get("publishedAt")).strftime("%Y-%m-%d")) or None,
             "orgWebsite": c.get("orgWebsite") if good_url(c.get("orgWebsite")) else None,
             "nextAction": str(c.get("nextAction") or "").strip()[:300], "contactStrategy": str(c.get("contactStrategy") or "").strip()[:400],
             "region": str(c.get("region") or "").strip()[:60]}
        # never store contact details, deadlines or values without the source that states them
        ct = c.get("contact") or {}
        if ct.get("text") and good_url(ct.get("sourceUrl")):
            o["contact"] = {"text": str(ct["text"])[:200], "sourceUrl": ct["sourceUrl"]}
        elif ct.get("text"):
            notes.append(f"#{i}: contact dropped — no source")
        dl = c.get("deadline") or {}
        if dl.get("date") and good_url(dl.get("sourceUrl")) and parse_date(dl.get("date")):
            o["deadline"] = {"date": parse_date(dl["date"]).strftime("%Y-%m-%d"), "sourceUrl": dl["sourceUrl"], "label": str(dl.get("label") or "Deadline")[:80]}
        elif dl.get("date"):
            notes.append(f"#{i}: deadline dropped — no source")
        ev = c.get("estValue") or {}
        try:
            amt = float(ev.get("amount")) if ev.get("amount") is not None else None
        except Exception:
            amt = None
        if amt and good_url(ev.get("sourceUrl")):
            cur = str(ev.get("currency") or "EGP").upper()
            o["estValue"] = {"amount": amt, "currency": cur, "basis": str(ev.get("basis") or "as published")[:200], "sourceUrl": ev["sourceUrl"],
                             "amountEgp": amt if cur == "EGP" else (amt * float(ev["fx"]) if ev.get("fx") else None)}
        elif amt:
            notes.append(f"#{i}: value dropped — no source")
        claims = []
        for cl in (c.get("claims") or [])[:12]:
            t = str(cl.get("text") or "").strip()[:300]
            if not t:
                continue
            claims.append({"text": t, "sourceUrl": cl.get("sourceUrl") if good_url(cl.get("sourceUrl")) else None,
                           "status": "sourced" if good_url(cl.get("sourceUrl")) else "unverified"})
        o["claims"] = claims
        o["unverified"] = [x["text"] for x in claims if x["status"] == "unverified"] + [str(x)[:200] for x in (c.get("toConfirm") or [])][:10]
        # de-duplicate: same source URL, same organisation + location, or near-identical title
        dup = None
        for k, d in seen_keys.items():
            if d.get("sourceUrl") == url or any(s.get("url") == url for s in d.get("sources") or []):
                dup = k
                break
            if o["organization"] and norm(d.get("organization")) == norm(o["organization"]) and (not o["location"] or jacc(d.get("location"), o["location"]) >= 0.5) and jacc(d.get("title"), title) >= 0.35:
                dup = k
                break
            if jacc(d.get("title"), title) >= 0.8:
                dup = k
                break
        if dup:
            d = dict(seen_keys[dup])
            srcs = list(d.get("sources") or [{"url": d.get("sourceUrl"), "org": d.get("sourceOrg"), "at": d.get("discoveredAt")}])
            if not any(s.get("url") == url for s in srcs):
                srcs.append({"url": url, "org": o["sourceOrg"], "at": iso(now), "publishedAt": o["publishedAt"]})
                d["sources"] = srcs[-10:]
                d["history"] = (d.get("history") or []) + [{"at": iso(now), "by": "research", "action": "Seen again in a new source", "detail": url}]
                notes.append(f"#{i}: duplicate of {dup} — new source added")
            else:
                notes.append(f"#{i}: duplicate of {dup} — already known")
            d["lastChecked"] = iso(now)
            d["history"] = (d.get("history") or [])[-80:]
            writes.append({"collection": "mi/opps/o", "doc_id": dup, "data": d})
            seen_keys[dup] = d
            updated += 1
            continue
        total, parts = score_opp(o, now)
        cls = source_class(url, o["sourceType"])
        auto_verified = cls in ("official", "organization") and o["publishedAt"] and not o["unverified"]
        high = total >= 70 or ((o.get("estValue") or {}).get("amountEgp") or 0) >= 10e6
        oid = "op-" + sid(o["organization"] or title, o["location"], title)
        o.update({"id": oid, "status": "new", "evidence": "verified" if auto_verified and not high else "single-source" if cls != "other" else "unverified",
                  "evidenceNote": ("Official/organisation source with date; all claims sourced" if auto_verified else
                                   f"{cls.capitalize()} source; {len(o['unverified'])} point(s) still to confirm" if o["unverified"] else f"One {cls} source; confirm independently"),
                  "needsApproval": bool(high), "score": total, "scoreParts": parts, "priority": "high" if total >= 70 else "medium" if total >= 50 else "low",
                  "sourceClass": cls, "sources": [{"url": url, "org": o["sourceOrg"], "at": iso(now), "publishedAt": o["publishedAt"]}],
                  "discoveredAt": iso(now), "lastChecked": iso(now), "assignedTo": None, "followUp": None, "notes": [],
                  "history": [{"at": iso(now), "by": "research", "action": "Discovered", "detail": f"Score {total} · {cls} source"}],
                  "confidence": "medium" if cls in ("official", "organization", "reputable") else "low", "dedupKey": sid(o["organization"], o["location"])})
        if auto_verified and high:
            o["evidenceNote"] += " — high-impact: an administrator must approve before it is treated as confirmed"
        writes.append({"collection": "mi/opps/o", "doc_id": oid, "data": o})
        seen_keys[oid] = o
        created += 1
    # expire records whose sourced deadline has passed
    for k, d in existing.items():
        dl = parse_date((d.get("deadline") or {}).get("date"))
        if dl and dl < now - timedelta(days=1) and d.get("status") in ("new", "review", "verified", "qualified"):
            d = dict(d)
            d["status"] = "expired"
            d["history"] = (d.get("history") or []) + [{"at": iso(now), "by": "research", "action": "Status: Expired", "detail": f"Deadline {d['deadline']['date']} passed"}]
            if not any(w["doc_id"] == k for w in writes):
                writes.append({"collection": "mi/opps/o", "doc_id": k, "data": d})
                updated += 1
    return writes, created, updated


# ---------------------------------------------------------------- news
def ingest_news(root, cands, now, notes):
    existing = docs(root, "mix/news/n")
    writes, created = [], 0
    for i, c in enumerate(cands if isinstance(cands, list) else []):
        h, url = str(c.get("headline") or "").strip()[:250], str(c.get("url") or "").strip()
        if not h or not good_url(url):
            notes.append(f"news #{i}: dropped — no headline or source URL")
            continue
        if any(d.get("url") == url or jacc(d.get("headline"), h) >= 0.8 for d in existing.values()):
            notes.append(f"news #{i}: duplicate")
            continue
        cls = source_class(url)
        st = c.get("sourceType") if c.get("sourceType") in ("official", "media", "industry", "unconfirmed") else ("official" if cls == "official" else "media" if cls == "reputable" else "unconfirmed")
        if st == "official" and cls != "official":
            st = "media"  # an official label needs an official domain
        lvl = c.get("impactLevel") if c.get("impactLevel") in ("low", "medium", "high") else "low"
        nid = "nw-" + sid(h, url)
        pub = parse_date(c.get("publishedAt"))
        d = {"id": nid, "headline": h, "source": str(c.get("source") or host(url))[:120], "url": url, "sourceType": st, "area": c.get("area") if c.get("area") in ("shipping", "customs", "regulatory", "materials", "procurement", "market") else "market",
             "publishedAt": pub.strftime("%Y-%m-%d") if pub else None, "discoveredAt": iso(now), "summary": str(c.get("summary") or "")[:1200], "whyItMatters": str(c.get("whyItMatters") or "")[:800],
             "relevantTo": [str(x)[:60] for x in (c.get("relevantTo") or [])][:8], "impact": str(c.get("impact") or "")[:500], "impactLevel": lvl,
             "verification": "official announcement" if st == "official" else "media report" if st in ("media", "industry") else "unconfirmed",
             "nextStep": str(c.get("nextStep") or "")[:400], "needsProfessional": bool(c.get("needsProfessional")) or c.get("area") in ("customs", "regulatory"), "status": "new"}
        writes.append({"collection": "mix/news/n", "doc_id": nid, "data": d})
        existing[nid] = d
        created += 1
    return writes, created, 0


# ---------------------------------------------------------------- currency
def ingest_fx(root, cands, now, notes):
    snaps = docs(root, "mix/fx/r")
    last = {}
    for k in sorted(snaps):
        for code, r in (snaps[k].get("rates") or {}).items():
            if r.get("status") != "rejected":
                last[code] = dict(r, date=k)
    day = now.strftime("%Y-%m-%d")
    snap = dict(snaps.get(day) or {"date": day, "base": "EGP", "convention": "EGP per 1 unit of the foreign currency", "rates": {}})
    snap["rates"] = dict(snap.get("rates") or {})
    got = 0
    for i, c in enumerate(cands if isinstance(cands, list) else []):
        code = "CNY" if str(c.get("code") or "").upper() in ("RMB", "CNY") else str(c.get("code") or "").upper()
        try:
            val = float(c.get("egpPer"))
        except Exception:
            val = None
        url = str(c.get("url") or "")
        if code not in CURRENCIES or not val or val <= 0 or not good_url(url):
            notes.append(f"fx #{i}: dropped ({code or 'no code'}: value or source missing)")
            continue
        prev = last.get(code)
        status, note = "ok", ""
        if prev and prev.get("egpPer"):
            ch = val / prev["egpPer"] - 1
            if abs(ch) > 0.15:
                status, note = "review", f"Moved {ch * 100:.1f}% since {prev['date']}: kept for review, the previous value stays current"
        snap["rates"][code] = {"egpPer": round(val, 4), "source": str(c.get("source") or host(url))[:120], "url": url, "kind": c.get("kind") if c.get("kind") in ("official", "bank", "market") else "market",
                               "rateType": str(c.get("rateType") or "")[:40], "publishedAt": c.get("publishedAt"), "retrievedAt": iso(now), "status": status, "note": note,
                               "prevEgpPer": prev.get("egpPer") if prev else None, "prevDate": prev.get("date") if prev else None}
        got += 1
    missing = [c for c in CURRENCIES if c not in snap["rates"]]
    if missing:
        notes.append("No new value for " + ", ".join(missing) + " — the last saved values stay in use and are shown with their age.")
    writes = [{"collection": "mix/fx/r", "doc_id": day, "data": snap}] if got else []
    return writes, (1 if got and day not in snaps else 0), (1 if got and day in snaps else 0)


# ---------------------------------------------------------------- materials
def latest_fx(root):
    snaps = docs(root, "mix/fx/r")
    out = {}
    for k in sorted(snaps):
        for code, r in (snaps[k].get("rates") or {}).items():
            if r.get("status") == "ok":
                out[code] = r["egpPer"]
    return out


UNIT_CONV = {("t", "kg"): 1 / 1000, ("ton", "kg"): 1 / 1000, ("tonne", "kg"): 1 / 1000, ("kg", "kg"): 1, ("m3", "m3"): 1, ("l", "L"): 1, ("L", "L"): 1, ("m2", "m2"): 1, ("m", "m"): 1}


def ingest_materials(root, cands, now, notes):
    mats, fx = docs(root, "mix/mat/m"), latest_fx(root)
    writes, updated = [], 0
    for i, c in enumerate(cands if isinstance(cands, list) else []):
        mid = str(c.get("materialId") or "")
        m = mats.get(mid)
        url = str(c.get("url") or "")
        try:
            price = float(c.get("price"))
        except Exception:
            price = None
        if not m or not price or price <= 0 or not good_url(url):
            notes.append(f"material #{i}: dropped ({mid or 'no id'}: unknown material, price or source missing)")
            continue
        unit = str(c.get("unit") or m.get("unit"))
        k = UNIT_CONV.get((unit, m.get("unit"))) or UNIT_CONV.get((unit.lower(), m.get("unit")))
        if k is None:
            notes.append(f"material #{i}: dropped ({mid}: unit {unit} cannot be converted to {m.get('unit')})")
            continue
        cur = str(c.get("currency") or "EGP").upper()
        egp = price * k if cur == "EGP" else (price * k * fx[cur] if cur in fx else None)
        if egp is None:
            notes.append(f"material #{i}: dropped ({mid}: no saved {cur} rate to convert)")
            continue
        pt = c.get("priceType") if c.get("priceType") in ("indicative", "supplier_quote", "official_index", "purchase") else "indicative"
        if pt in ("supplier_quote", "purchase"):
            pt = "indicative"   # research can never create a supplier quotation or a purchase price — those are entered by staff
            notes.append(f"material #{i}: stored as indicative (quotes and purchase prices are entered by administrators)")
        prices = list(m.get("prices") or [])
        prev = next((p for p in reversed(prices) if p.get("status") != "rejected"), None)
        pub = parse_date(c.get("publishedAt"))
        rec = {"egpPerUnit": round(egp, 4), "price": price, "currency": cur, "unit": unit, "type": pt, "source": str(c.get("source") or host(url))[:160], "url": url,
               "market": str(c.get("market") or "")[:80], "publishedAt": pub.strftime("%Y-%m-%d") if pub else None, "retrievedAt": iso(now), "by": "research",
               "status": "ok", "confidence": "medium" if source_class(url) in ("official", "reputable") else "low", "note": str(c.get("note") or "")[:300]}
        if prev and prev.get("egpPerUnit"):
            ch = egp / prev["egpPerUnit"] - 1
            rec["changePct"] = round(ch * 100, 2)
            if abs(ch) > 0.35:
                rec["status"] = "review"
                rec["note"] = (rec["note"] + " " if rec["note"] else "") + f"Moved {ch * 100:.0f}% — check before use."
        if any(p.get("url") == url and p.get("egpPerUnit") == rec["egpPerUnit"] for p in prices):
            notes.append(f"material #{i}: same price and source already stored")
            continue
        m = dict(m)
        m["prices"] = (prices + [rec])[-60:]
        m["updatedAt"] = iso(now)
        writes.append({"collection": "mix/mat/m", "doc_id": mid, "data": m})
        mats[mid] = m
        updated += 1
    return writes, 0, updated


# ---------------------------------------------------------------- weekly report
def week_id(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def ingest_weekly(root, rep, now, notes):
    if not isinstance(rep, dict):
        notes.append("weekly: no report object")
        return [], 0, 0
    opps = docs(root, "mi/opps/o")
    wk = week_id(now)
    start = now - timedelta(days=7)
    prev_start = now - timedelta(days=14)
    disc = [o for o in opps.values() if (parse_date(o.get("discoveredAt")) or now) >= start]
    disc_prev = [o for o in opps.values() if prev_start <= (parse_date(o.get("discoveredAt")) or now) < start]
    ignored = [o for o in opps.values() if o.get("status") in ("new", "review", "verified", "qualified") and (parse_date(o.get("discoveredAt")) or now) < now - timedelta(days=7) and not o.get("assignedTo")]
    stale_assigned = [o for o in opps.values() if o.get("status") == "assigned" and (parse_date((o.get("history") or [{}])[-1].get("at")) or now) < now - timedelta(days=7)]

    def srcs(x):
        return [s for s in (x.get("sources") or []) if isinstance(s, dict) and good_url(s.get("url"))] if isinstance(x, dict) else []
    facts, moved = [], 0
    for f in rep.get("facts") or []:
        if srcs(f):
            facts.append({"text": str(f.get("text"))[:600], "sources": srcs(f)})
        else:
            moved += 1
            (rep.setdefault("unknowns", [])).append({"text": str(f.get("text"))[:600] + " (no source — not stated as fact)"})
    if moved:
        notes.append(f"weekly: {moved} unsourced 'fact(s)' moved to unknowns")
    recs = []
    for r in (rep.get("recommendations") or [])[:12]:
        recs.append({k: (str(r.get(k))[:500] if r.get(k) is not None else "") for k in ("title", "reason", "benefit", "effort", "risks", "nextStep", "owner", "deadline")} | {"evidence": srcs(r) or [], "oppIds": [x for x in (r.get("oppIds") or []) if x in opps]})
    d = {"id": wk, "week": wk, "createdAt": iso(now), "periodStart": start.strftime("%Y-%m-%d"), "periodEnd": now.strftime("%Y-%m-%d"),
         "executiveSummary": str(rep.get("executiveSummary") or "")[:3000], "changes": [str(x)[:500] for x in rep.get("changes") or []][:15],
         "priorities": [{"text": str(p.get("text"))[:400], "oppId": p.get("oppId") if p.get("oppId") in opps else None, "owner": str(p.get("owner") or "")[:80], "deadline": str(p.get("deadline") or "")[:20]} for p in rep.get("priorities") or []][:12],
         "threats": [{"text": str(t.get("text") if isinstance(t, dict) else t)[:500], "sources": srcs(t)} for t in rep.get("threats") or []][:10],
         "facts": facts[:25], "inferences": [{"text": str(x.get("text") if isinstance(x, dict) else x)[:500]} for x in rep.get("inferences") or []][:20],
         "recommendations": recs, "unknowns": [{"text": str(x.get("text") if isinstance(x, dict) else x)[:500]} for x in rep.get("unknowns") or []][:20],
         "sources": [{"title": str(s.get("title") or host(s.get("url")))[:200], "url": s.get("url")} for s in rep.get("sources") or [] if isinstance(s, dict) and good_url(s.get("url"))][:60],
         "dataQuality": str(rep.get("dataQuality") or "")[:1200],
         "stats": {"discoveredThisWeek": len(disc), "discoveredPrevWeek": len(disc_prev), "notFollowedUp": len(ignored), "assignedNoUpdate7d": len(stale_assigned),
                   "byCategory": _count(disc, "category"), "byStatus": _count(opps.values(), "status"), "highPriorityOpen": len([o for o in opps.values() if o.get("priority") == "high" and o.get("status") not in ("won", "lost", "rejected", "expired")])},
         "ignoredIds": [o.get("id") for o in ignored][:30]}
    return [{"collection": "mix/reports/w", "doc_id": wk, "data": d}], 1, 0


def _count(items, k):
    out = {}
    for o in items:
        out[o.get(k) or "other"] = out.get(o.get(k) or "other", 0) + 1
    return out


def main():
    if len(sys.argv) < 4 or sys.argv[1] not in JOBS:
        print(json.dumps({"error": "usage: intel.py <" + "|".join(JOBS) + "> <dump_dir> <candidates.json> [now]"}))
        sys.exit(2)
    job, root, cfile = sys.argv[1], sys.argv[2], sys.argv[3]
    now = now_utc(sys.argv[4] if len(sys.argv) > 4 else None)
    cands = load(cfile)
    notes = []
    prev = (docs(root, "mi/state/jobs") or {}).get(job)
    sched = ((load(os.path.join(root, "mi", "schedule.json")) or {}).get("jobs") or {}).get(job) or {}
    try:
        fn = {"opportunities": ingest_opps, "news": ingest_news, "fx": ingest_fx, "materials": ingest_materials, "weekly": ingest_weekly}[job]
        if cands is None:
            raise ValueError("candidates file missing or not valid JSON")
        writes, created, updated = fn(root, cands, now, notes)
        ok = True
        err = None
    except Exception as e:  # keep the last good data; record the failure
        writes, created, updated, ok, err = [], 0, 0, False, f"{type(e).__name__}: {e}"
    high = [w["data"] for w in writes if w["collection"] == "mi/opps/o" and w["data"].get("priority") == "high" and any(h.get("action") == "Discovered" and h.get("at") == iso(now) for h in w["data"].get("history") or [])]
    news_hi = [w["data"] for w in writes if w["collection"] == "mix/news/n" and w["data"].get("impactLevel") == "high"]
    writes.append({"collection": "mi/state/jobs", "doc_id": job, "data": job_doc(job, now, ok, created, updated, notes, err, prev, sched.get("label"))})
    writes.append({"collection": "mi/runs/r", "doc_id": f"{now.strftime('%Y%m%dT%H%M%S')}-{job}", "data": {"job": job, "label": JOBS[job], "at": iso(now), "ok": ok, "created": created, "updated": updated, "notes": notes[:30], "error": err,
                                                                                                        "candidates": len(cands) if isinstance(cands, list) else (1 if cands else 0)}})
    print(json.dumps({"job": job, "now": iso(now), "ok": ok, "error": err, "writes": writes, "notes": notes, "stats": {"created": created, "updated": updated},
                      "notify": {"highOpportunities": [{"id": o["id"], "title": o["title"], "score": o["score"]} for o in high], "highImpactNews": [{"id": n["id"], "headline": n["headline"]} for n in news_hi]}},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
