/* X FORCE — Commercial Intelligence, Phase 0: a small gazetteer of Egypt, used to place opportunities on the map at an honest precision.
   Pure functions, no storage, no outside calls. Needs app/miengine.js (fold, hasWord) to be loaded first.

   GOVS   the 27 governorates: English and Arabic names, the capital's approximate centre
   AREAS  named cities, new towns and coastal areas that matter for Dupedia, each in one governorate, with an approximate centre
   locate(text) → { precision: "area" | "governorate" | "foreign" | "unknown", gov, area, lat, lng, note }

   Centres are approximate (about 0.01°) and only for drawing a map ring: they are never shown as an address. A project is
   placed exactly only when a source gives coordinates or an administrator places it (a later phase). */
(function (root) {
  "use strict";
  const E = () => root.DPMiEngine;

  // [key, English name, Arabic name, lat, lng, other names]
  const GOVS = [
    ["cairo", "Cairo", "القاهرة", 30.044, 31.236, []], ["giza", "Giza", "الجيزة", 30.013, 31.209, []], ["alexandria", "Alexandria", "الإسكندرية", 31.200, 29.918, ["alex"]],
    ["qalyubia", "Qalyubia", "القليوبية", 30.466, 31.184, ["qaliubiya", "kalyubia"]], ["sharqia", "Sharqia", "الشرقية", 30.587, 31.502, ["sharkia"]],
    ["dakahlia", "Dakahlia", "الدقهلية", 31.041, 31.378, ["daqahliya"]], ["gharbia", "Gharbia", "الغربية", 30.787, 31.000, []], ["monufia", "Monufia", "المنوفية", 30.553, 31.009, ["menoufia", "menofia"]],
    ["beheira", "Beheira", "البحيرة", 31.036, 30.469, ["behira"]], ["kafrelsheikh", "Kafr El Sheikh", "كفر الشيخ", 31.111, 30.940, ["kafr el-sheikh"]], ["damietta", "Damietta", "دمياط", 31.417, 31.814, []],
    ["portsaid", "Port Said", "بورسعيد", 31.265, 32.302, ["port-said", "بور سعيد"]], ["ismailia", "Ismailia", "الإسماعيلية", 30.596, 32.272, []], ["suez", "Suez", "السويس", 29.966, 32.550, []],
    ["northsinai", "North Sinai", "شمال سيناء", 31.132, 33.798, ["arish", "العريش"]], ["southsinai", "South Sinai", "جنوب سيناء", 28.241, 33.622, []],
    ["redsea", "Red Sea", "البحر الأحمر", 27.258, 33.812, []], ["matrouh", "Matrouh", "مطروح", 31.354, 27.237, ["marsa matruh", "marsa matrouh", "mersa matruh", "مرسى مطروح"]],
    ["newvalley", "New Valley", "الوادي الجديد", 25.439, 30.546, ["kharga", "الخارجة"]], ["faiyum", "Faiyum", "الفيوم", 29.308, 30.842, ["fayoum", "fayum"]],
    ["benisuef", "Beni Suef", "بني سويف", 29.074, 31.097, ["beni-suef"]], ["minya", "Minya", "المنيا", 28.110, 30.750, ["minia"]], ["asyut", "Asyut", "أسيوط", 27.181, 31.183, ["assiut"]],
    ["sohag", "Sohag", "سوهاج", 26.556, 31.695, []], ["qena", "Qena", "قنا", 26.164, 32.727, []], ["luxor", "Luxor", "الأقصر", 25.687, 32.639, []], ["aswan", "Aswan", "أسوان", 24.089, 32.899, []],
  ];
  // [key, governorate, English name, Arabic name, lat, lng, other names]
  const AREAS = [
    ["newcairo", "cairo", "New Cairo", "القاهرة الجديدة", 30.030, 31.470, ["fifth settlement", "5th settlement", "tagamoa", "التجمع الخامس"]],
    ["madinaty", "cairo", "Madinaty", "مدينتي", 30.100, 31.640, []], ["shorouk", "cairo", "El Shorouk", "الشروق", 30.140, 31.620, ["shorouk city", "el-shorouk"]],
    ["mostakbal", "cairo", "Mostakbal City", "مستقبل سيتي", 30.100, 31.560, ["future city", "مدينة المستقبل"]],
    ["nac", "cairo", "New Administrative Capital", "العاصمة الإدارية الجديدة", 30.020, 31.760, ["new capital", "administrative capital", "العاصمة الإدارية"]],
    ["badr", "cairo", "Badr City", "مدينة بدر", 30.140, 31.720, []], ["heliopolis", "cairo", "Heliopolis", "مصر الجديدة", 30.090, 31.330, []],
    ["nasrcity", "cairo", "Nasr City", "مدينة نصر", 30.060, 31.330, []], ["maadi", "cairo", "Maadi", "المعادي", 29.960, 31.250, []],
    ["zayed", "giza", "Sheikh Zayed", "الشيخ زايد", 30.050, 30.980, ["sheikh zayed city", "zayed city", "new zayed", "زايد الجديدة"]],
    ["october", "giza", "6th of October", "السادس من أكتوبر", 29.940, 30.910, ["6th of october city", "sixth of october", "october city", "مدينة 6 أكتوبر", "مدينة السادس من أكتوبر"]],
    ["newgiza", "giza", "New Giza", "نيو جيزة", 30.010, 31.040, []],
    ["northcoast", "matrouh", "North Coast", "الساحل الشمالي", 30.950, 28.800, ["sahel"]],
    ["sidiabdelrahman", "matrouh", "Sidi Abdel Rahman", "سيدي عبد الرحمن", 30.970, 28.700, ["sidi abd el rahman", "sidi abdelrahman"]],
    ["alamein", "matrouh", "New Alamein", "العلمين الجديدة", 30.830, 28.950, ["el alamein", "alamein", "العلمين"]],
    ["rasalhekma", "matrouh", "Ras El Hekma", "رأس الحكمة", 31.150, 27.820, ["ras el-hekma", "ras al hekma", "ras elhekma"]],
    ["sokhna", "suez", "Ain Sokhna", "العين السخنة", 29.600, 32.320, ["ain el sokhna", "el sokhna", "sokhna", "السخنة"]],
    ["galala", "suez", "Galala", "الجلالة", 29.400, 32.380, ["el galala", "galala city"]],
    ["hurghada", "redsea", "Hurghada", "الغردقة", 27.258, 33.812, []], ["gouna", "redsea", "El Gouna", "الجونة", 27.390, 33.680, ["gouna"]],
    ["sahlhasheesh", "redsea", "Sahl Hasheesh", "سهل حشيش", 27.050, 33.890, []], ["somabay", "redsea", "Soma Bay", "سوما باي", 26.850, 33.980, []],
    ["safaga", "redsea", "Safaga", "سفاجا", 26.750, 33.940, []], ["marsaalam", "redsea", "Marsa Alam", "مرسى علم", 25.070, 34.890, []],
    ["sharm", "southsinai", "Sharm El Sheikh", "شرم الشيخ", 27.915, 34.330, ["sharm el-sheikh", "sharm"]], ["dahab", "southsinai", "Dahab", "دهب", 28.500, 34.510, []],
    ["borgelarab", "alexandria", "Borg El Arab", "برج العرب", 30.870, 29.580, ["new borg el arab", "برج العرب الجديدة"]],
    ["obour", "qalyubia", "El Obour", "العبور", 30.230, 31.480, ["obour city", "el-obour"]],
    ["ramadan10", "sharqia", "10th of Ramadan", "العاشر من رمضان", 30.300, 31.750, ["tenth of ramadan", "10th of ramadan city"]],
    ["newmansoura", "dakahlia", "New Mansoura", "المنصورة الجديدة", 31.500, 31.300, []], ["mansoura", "dakahlia", "Mansoura", "المنصورة", 31.041, 31.378, []],
    ["newdamietta", "damietta", "New Damietta", "دمياط الجديدة", 31.440, 31.680, []],
  ];
  // Places outside Egypt that appear in Egyptian real-estate news. Checked before anything else.
  const FOREIGN = ["saudi", "saudi arabia", "ksa", "riyadh", "jeddah", "neom", "uae", "dubai", "abu dhabi", "qatar", "doha", "kuwait", "oman", "bahrain", "jordan", "libya", "tripoli", "benghazi",
    "iraq", "morocco", "usa", "united states", "virginia", "california", "uk", "london",
    "السعودية", "المملكة العربية السعودية", "الرياض", "جدة", "نيوم", "الإمارات", "دبي", "أبوظبي", "أبو ظبي", "قطر", "الدوحة", "الكويت", "عمان", "البحرين", "الأردن", "ليبيا", "العراق", "المغرب"];
  const EGYPT = ["egypt", "egyptian", "مصر", "جمهورية مصر العربية"];

  const govByKey = Object.fromEntries(GOVS.map((g) => [g[0], g]));
  const words = (list) => list.slice().sort((a, b) => b.length - a.length);
  let IDX = null;
  function index() {
    if (IDX) return IDX;
    const areas = [], govs = [];
    for (const a of AREAS) for (const n of words([a[2], a[3]].concat(a[6]))) areas.push([n, a]);
    for (const g of GOVS) for (const n of words([g[1], g[2]].concat(g[5]))) govs.push([n, g]);
    areas.sort((x, y) => y[0].length - x[0].length); govs.sort((x, y) => y[0].length - x[0].length);
    return (IDX = { areas, govs });
  }
  const hit = (text, w) => E().hasWord(text, w);

  function locate(raw) {
    const text = E().fold(raw || "").replace(/[-–—_,،.;:()/]+/g, " ").replace(/\s+/g, " ").trim();
    const none = { precision: "unknown", gov: null, area: null, lat: null, lng: null, note: "" };
    if (!text) return Object.assign(none, { note: "No location given." });
    const egypt = EGYPT.some((w) => hit(text, w)), foreign = FOREIGN.find((w) => hit(text, w));
    const { areas, govs } = index();
    const a = areas.find(([w]) => hit(text, w)), g = govs.find(([w]) => hit(text, w));
    if (foreign && !egypt) return Object.assign(none, { precision: "foreign", note: `Outside Egypt (${foreign}).` });
    if (a) { const [key, gov, en, , lat, lng] = a[1]; return { precision: "area", gov, area: key, lat, lng, note: `${en}, ${govByKey[gov][1]}. Area centre, approximate.` }; }
    if (g) {
      const [key, en, , lat, lng] = g[1];
      // "Red Sea" alone is also Saudi Arabia's coast: placed in Egypt's governorate only when Egypt is named.
      if (key === "redsea" && !egypt) return Object.assign(none, { note: "Red Sea, country not stated." });
      return { precision: "governorate", gov: key, area: null, lat, lng, note: `${en} governorate. Not placed more precisely.` };
    }
    return Object.assign(none, { note: egypt ? "Egypt, place not recognised." : "Place not recognised." });
  }

  root.DPGeo = { GOVS: GOVS.map(([key, en, ar, lat, lng]) => ({ key, en, ar, lat, lng })), AREAS: AREAS.map(([key, gov, en, ar, lat, lng]) => ({ key, gov, en, ar, lat, lng })), locate };
})(typeof self !== "undefined" ? self : globalThis);
