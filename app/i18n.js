/* X FORCE 1.2 (Dupedia) — English / Arabic interface language with right-to-left layout.
   One central dictionary (English text → Arabic). The chosen language is kept per person (this browser, and their own
   settings record when signed in to the server) and applied to the whole page: dir="rtl", lang="ar", and every piece of
   interface text that has a translation. Text without a translation stays in English — names, figures, references and
   anything typed by people are never translated. Numbers keep Western digits so amounts read the same in both languages. */
/* global DPStore */
(function (root) {
  "use strict";
  const KEY = "xf-lang";
  const AR = {
    // navigation
    "Dashboard": "لوحة التحكم", "CEO Control Center": "مركز تحكم الرئيس التنفيذي", "Site Planner": "مخطط الموقع", "My Orders & Proposals": "طلباتي وعروضي", "Drafts & Projects": "المسودات والمشروعات",
    "Lead Mine": "منجم العملاء المحتملين", "My Leads": "عملائي المحتملون", "Calls & Follow-ups": "المكالمات والمتابعات", "Call Log": "سجل المكالمات", "My Commission": "عمولتي", "Messages": "الرسائل", "My Profile": "ملفي الشخصي",
    "Market Intelligence": "معلومات السوق", "Engineering Orders": "طلبات الهندسة", "Factory": "المصنع", "Worker Directory": "دليل العمال", "Lead Research": "بحث العملاء", "Sign out": "تسجيل الخروج",
    "Administration": "الإدارة", "Finance": "المالية", "Mission Control": "غرفة القيادة", "Ask CEO Inbox": "صندوق اسأل الرئيس التنفيذي", "Order Register": "سجل الطلبات", "Payment Verification": "التحقق من المدفوعات",
    "Payments & Approvals": "المدفوعات والموافقات", "Approve Commission": "اعتماد العمولات", "Engineering": "الهندسة", "All Leads": "كل العملاء المحتملين", "Work Force": "فريق العمل", "Employees": "الموظفون",
    "User Management": "إدارة المستخدمين", "Commission Rules": "قواعد العمولة", "Product Pricing": "تسعير المنتجات", "Reports": "التقارير", "Audit Log": "سجل التدقيق", "Company Search": "البحث في الشركة", "Settings": "الإعدادات",
    "Finance Dashboard": "لوحة المالية", "Transfers": "التحويلات", "Financial Accounts": "الحسابات المالية", "Salaries & Payroll": "الرواتب والأجور", "Purchases": "المشتريات", "Invoices & Receipts": "الفواتير والإيصالات",
    "Commissions": "العمولات", "Taxes": "الضرائب", "Finance Reports": "التقارير المالية",
    "Growth Command Center": "مركز قيادة النمو", "Campaigns & Content": "الحملات والمحتوى", "Project Radar": "رادار المشروعات", "Partnerships": "الشراكات", "My Target Accounts": "حساباتي المستهدفة", "Growth & marketing": "النمو والتسويق",
    "Production Jobs": "أوامر الإنتاج", "Factory Dashboard": "لوحة المصنع", "Machines & Tools": "الماكينات والأدوات", "Dupedia Products": "منتجات ديوبيديا", "Products": "المنتجات", "Holidays": "العطلات", "Reminders": "التذكيرات", "Factory & products": "المصنع والمنتجات",
    "New reminder": "تذكير جديد", "Done": "تم", "Open": "فتح", "Overdue": "متأخر", "All": "الكل", "Clear all…": "مسح الكل…", "Mark all as read": "تعليم الكل كمقروء", "Show cleared": "عرض الممسوح", "Notification Center": "مركز الإشعارات",
    "Needs your attention": "يحتاج انتباهك", "Factory progress": "تقدم التصنيع", "Stage": "المرحلة", "Overview": "نظرة عامة", "Measurements & drawings": "القياسات والرسومات", "BOM & cutting plans": "الخامات وخطط القص", "Materials & waste": "الخامات والهالك", "Quality & notes": "الجودة والملاحظات", "History": "السجل",
    // common actions
    "Save": "حفظ", "Cancel": "إلغاء", "Close": "إغلاق", "Edit": "تعديل", "Details": "التفاصيل", "Open": "فتح", "Approve": "اعتماد", "Reject": "رفض", "Reject…": "رفض…", "Cancel…": "إلغاء…", "Reverse…": "عكس القيد…",
    "Print": "طباعة", "PDF": "PDF", "Export CSV": "تصدير CSV", "Search": "بحث", "Add": "إضافة", "Remove": "إزالة", "remove": "إزالة", "Attach…": "إرفاق…", "Attach proof…": "إرفاق إثبات…", "Pay…": "دفع…", "Post": "ترحيل",
    "New transfer": "تحويل جديد", "Create transfer": "إنشاء التحويل", "Record payment": "تسجيل الدفع", "Add account": "إضافة حساب", "Save account": "حفظ الحساب", "Record purchase": "تسجيل مشتريات", "Add supplier": "إضافة مورد",
    "New from an order": "جديد من طلب", "Prepare": "تجهيز", "Received": "تم الاستلام", "Save salary": "حفظ الراتب", "Set salary": "تحديد الراتب", "Change": "تغيير", "Add tax rule": "إضافة قاعدة ضريبية", "Save rule": "حفظ القاعدة",
    "Record a tax payment…": "تسجيل دفعة ضريبية…", "Save finance settings": "حفظ إعدادات المالية", "Verify payment": "تأكيد الدفعة", "Reject payment": "رفض الدفعة", "Add a lead": "إضافة عميل محتمل", "Add my own lead": "إضافة عميل محتمل خاص بي",
    "Add lead": "إضافة عميل محتمل", "Claim lead": "المطالبة بالعميل", "My Leads →": "عملائي المحتملون ←", "Change password…": "تغيير كلمة المرور…", "Prepare payroll for this month": "تجهيز رواتب هذا الشهر", "Submit for approval": "إرسال للاعتماد",
    "Create salary payments": "إنشاء دفعات الرواتب", "Record amount due": "تسجيل مبلغ مستحق", "Import statement (CSV)": "استيراد كشف حساب (CSV)", "Review & issue": "مراجعة وإصدار", "Send draft to Finance": "إرسال المسودة إلى المالية",
    "Request invoice / receipt…": "طلب فاتورة / إيصال…", "Prepare document…": "تجهيز مستند…", "Invoice / receipt…": "فاتورة / إيصال…", "Transfers for this order": "تحويلات هذا الطلب", "Open Payment Verification": "فتح التحقق من المدفوعات",
    "Open payroll": "فتح الرواتب", "Open purchases": "فتح المشتريات", "Open worker payments": "فتح دفعات العمال", "Open invoices": "فتح الفواتير", "Verify — post to the account": "تأكيد — ترحيل إلى الحساب", "Credit note…": "إشعار دائن…",
    // finance pages
    "Financial Command Center": "مركز القيادة المالي", "Overview": "نظرة عامة", "CEO overview": "نظرة الرئيس التنفيذي", "Approvals": "الموافقات", "Finance settings": "إعدادات المالية",
    "This month": "هذا الشهر", "Last month": "الشهر الماضي", "This quarter": "هذا الربع", "Year to date": "منذ بداية العام", "to": "إلى", "compare with the previous period": "المقارنة بالفترة السابقة",
    "Cash": "النقدية", "Customers": "العملاء", "Obligations": "الالتزامات", "Spending in the period": "المصروفات في الفترة", "Recent transactions": "أحدث المعاملات",
    "Book balance — all EGP accounts": "الرصيد الدفتري — كل الحسابات بالجنيه", "Inflows (external)": "المقبوضات (الخارجية)", "Outflows (external)": "المدفوعات (الخارجية)", "Net cash movement": "صافي حركة النقدية",
    "Verified customer payments": "مدفوعات العملاء المؤكدة", "Awaiting verification": "في انتظار التأكيد", "Outstanding customer balances": "أرصدة العملاء المستحقة", "Overdue customer payments": "مدفوعات العملاء المتأخرة",
    "Accounts payable": "الحسابات الدائنة", "Supplier payments due in 30 days": "مدفوعات الموردين المستحقة خلال 30 يومًا", "Payroll due": "الرواتب المستحقة", "Commissions awaiting approval": "عمولات في انتظار الاعتماد",
    "Approved commissions to pay": "عمولات معتمدة للدفع", "Operating expenses": "المصروفات التشغيلية", "Procurement & materials": "المشتريات والخامات", "Factory & worker costs": "تكاليف المصنع والعمال",
    "Salaries & commissions paid": "الرواتب والعمولات المدفوعة", "Tax liability (estimate)": "الالتزام الضريبي (تقديري)", "forecast": "توقع", "Horizon": "المدى", "Expected customer payments": "مدفوعات العملاء المتوقعة",
    "Known obligations": "الالتزامات المعروفة", "Projected book balance": "الرصيد الدفتري المتوقع", "Balances by account": "الأرصدة حسب الحساب", "Balances by channel (EGP)": "الأرصدة حسب القناة (جنيه)",
    "Monthly inflows and outflows (EGP, verified)": "المقبوضات والمدفوعات الشهرية (جنيه، مؤكدة)", "High-value or unusual in the period": "مبالغ كبيرة أو غير معتادة في الفترة",
    "What the Accountant may do": "صلاحيات المحاسب", "Defaults": "الإعدادات الافتراضية",
    "Date": "التاريخ", "Reference": "المرجع", "Type": "النوع", "Payee / payer": "المستفيد / الدافع", "Account": "الحساب", "Amount": "المبلغ", "Status": "الحالة", "Method": "طريقة الدفع", "Notes": "ملاحظات",
    "Department": "القسم", "Category": "الفئة", "Order": "الطلب", "Customer": "العميل", "Supplier": "المورد", "Total": "الإجمالي", "Paid": "مدفوع", "Due": "مستحق", "Employee": "الموظف", "Role": "الدور",
    "Base": "الأساسي", "Gross": "الإجمالي قبل الخصم", "Deductions": "الخصومات", "Net": "الصافي", "Month": "الشهر", "Number": "الرقم", "Project": "المشروع", "Worker": "العامل", "Workers": "العمال", "History": "السجل", "Payments": "المدفوعات",
    "Type *": "النوع *", "Date *": "التاريخ *", "Amount *": "المبلغ *", "From account": "من حساب", "To account": "إلى حساب", "Related order (optional)": "الطلب المرتبط (اختياري)",
    "Exactly what the money is for *": "الغرض من المبلغ بالتحديد *", "Attach supporting document": "إرفاق مستند داعم", "Attach payment proof": "إرفاق إثبات الدفع", "Proof and documents": "الإثباتات والمستندات",
    "Record the payment": "تسجيل الدفع", "Bank reference": "مرجع البنك", "InstaPay / wallet reference": "مرجع إنستاباي / المحفظة", "Payment date": "تاريخ الدفع", "Received into": "تم الإيداع في", "Paid from": "مدفوع من",
    "Book balance": "الرصيد الدفتري", "Statement balance": "رصيد الكشف", "Difference": "الفرق", "Last reconciled": "آخر تسوية", "Last reconciliation": "آخر تسوية", "never": "لم تتم", "Record reconciliation": "تسجيل التسوية",
    "Payroll": "الرواتب", "Salary profiles": "ملفات الرواتب", "Factory & installation workers": "عمال المصنع والتركيب", "Purchases & suppliers": "المشتريات والموردون", "Suppliers & workshops": "الموردون والورش",
    "Invoices & receipts": "الفواتير والإيصالات", "Drafts prepared by Sales": "مسودات أعدّها فريق المبيعات", "All documents": "كل المستندات", "Tax rules": "القواعد الضريبية", "Period summary": "ملخص الفترة",
    "Finance reports": "التقارير المالية", "Payment receipt": "إيصال استلام", "Tax invoice": "فاتورة ضريبية", "Credit note": "إشعار دائن", "Issued": "صادر", "Cancelled": "ملغى", "My payslips": "قسائم راتبي", "Files": "الملفات",
    // statuses
    "Draft": "مسودة", "Pending approval": "في انتظار الاعتماد", "Approved": "معتمد", "Payment recorded": "تم تسجيل الدفع", "Verified": "مؤكد", "Rejected": "مرفوض", "Reversed": "معكوس", "reversed": "معكوس",
    "Payroll prepared": "تم تجهيز الرواتب", "Awaiting approval": "في انتظار الاعتماد", "Approved for payment": "معتمد للدفع", "Partially paid": "مدفوع جزئيًا", "Payment rejected / failed": "الدفع مرفوض / فشل",
    "Incoming": "وارد", "Outgoing": "صادر", "Internal transfer": "تحويل داخلي", "Unpaid": "غير مدفوع", "Partly paid": "مدفوع جزئيًا", "Fully paid": "مدفوع بالكامل",
    "verified": "مؤكد", "not reviewed": "غير مراجَع", "reviewed": "مراجَع", "sensitive": "حساس",
    // transaction types
    "Customer receipt": "تحصيل من عميل", "Refund received": "استرداد مستلم", "Other income": "إيرادات أخرى", "Employee salary": "راتب موظف", "Sales commission": "عمولة مبيعات", "Worker salary / wage": "راتب / أجر عامل",
    "Worker / installation payment": "دفعة عامل / تركيب", "Outsourced worker / workshop": "عامل / ورشة خارجية", "Factory payment": "دفعة للمصنع", "Supplier / material purchase": "مورد / شراء خامات", "Operating expense": "مصروف تشغيلي",
    "Transport / delivery": "نقل / توصيل", "Tax payment": "دفعة ضريبية", "Refund to customer": "استرداد للعميل", "Other business payment": "دفعة أعمال أخرى", "Reversal": "قيد عكسي", "Other payment account": "حساب دفع آخر",
    "Bank transfer": "تحويل بنكي", "InstaPay": "إنستاباي", "Wallet": "محفظة", "Cash": "نقدي", "Cheque": "شيك", "Card": "بطاقة", "Other": "أخرى", "— choose —": "— اختر —",
    "Gross": "الإجمالي قبل الخصم", "Net payable": "صافي المستحق", "Deductions & recoveries": "الخصومات والاستردادات", "Paid (verified)": "المدفوع (مؤكد)", "Allowances + bonus": "البدلات + المكافأة",
    "With the selected lines:": "للبنود المحددة:", "Payee / payer *": "المستفيد / الدافع *", "Employee *": "الموظف *", "Worker *": "العامل *", "Supplier / workshop *": "المورد / الورشة *",
    "Committed (approved)": "الملتزم به (معتمد)", "Unpaid": "غير مدفوع", "Awaiting approval": "في انتظار الاعتماد", "All": "الكل", "All types": "كل الأنواع", "All statuses": "كل الحالات", "All accounts": "كل الحسابات", "In, out and internal": "وارد وصادر وداخلي",
    "Output tax (issued tax invoices − credit notes)": "ضريبة المخرجات (الفواتير الصادرة − الإشعارات الدائنة)", "Input tax (recoverable, on purchases)": "ضريبة المدخلات (القابلة للخصم على المشتريات)", "Estimated net liability": "صافي الالتزام التقديري",
    "Tax paid (verified)": "الضريبة المدفوعة (مؤكدة)", "Estimated outstanding": "المتبقي التقديري", "Missing documents": "مستندات ناقصة", "Treatment": "المعاملة الضريبية", "Rate": "النسبة", "Applies to": "تُطبق على", "Effective": "سارية", "Source": "المصدر", "Reviewed": "مراجَعة", "Rule": "القاعدة",
    "Net cash movement": "صافي حركة النقدية", "Payments to approve": "مدفوعات للاعتماد", "Payments to verify": "مدفوعات للتأكيد", "Customer payments to verify": "مدفوعات عملاء للتأكيد", "Payroll awaiting approval": "رواتب في انتظار الاعتماد",
    "Purchases awaiting approval": "مشتريات في انتظار الاعتماد", "Worker payments awaiting approval": "دفعات عمال في انتظار الاعتماد", "Amounts due": "المبالغ المستحقة", "Payment details": "بيانات الدفع", "Salary": "الراتب",
    "Base monthly": "الأساسي الشهري", "Allowances": "البدلات", "Paid by": "طريقة الصرف", "Effective from": "ساري من", "Employee": "الموظف", "Contact": "جهة الاتصال", "Approved purchases": "المشتريات المعتمدة", "Name": "الاسم",
    "All transactions on this account": "كل معاملات هذا الحساب", "Reconciliation history": "سجل التسويات", "Statement lines not matched": "بنود كشف غير مطابقة", "Recorded but not on the statement": "مسجلة وغير موجودة في الكشف", "As of": "حتى تاريخ",
    "Salaries &": "الرواتب و", "payroll": "الأجور", "Purchases &": "المشتريات و", "suppliers": "الموردون", "Invoices &": "الفواتير و", "receipts": "الإيصالات", "Financial": "المالية:", "Command Center": "مركز القيادة", "Accounts": "الحسابات", "Finance": "المالية", "reports": "التقارير",
    // account types
    "Bank account": "حساب بنكي", "InstaPay settlement account": "حساب تسوية إنستاباي", "Company wallet": "محفظة الشركة", "Petty cash": "عهدة نقدية", "Cash on hand": "نقدية بالخزينة",
    // general pages
    "Loading…": "جارٍ التحميل…", "Nothing waiting.": "لا يوجد شيء معلق.", "No transactions.": "لا توجد معاملات.", "None attached.": "لا توجد مرفقات.", "Language": "اللغة",
    "Performance": "الأداء", "Recent activity": "النشاط الأخير", "Summary": "الملخص", "Order items": "بنود الطلب", "Production & installation": "الإنتاج والتركيب",
    "Recent updates": "آخر التحديثات", "Timeline": "الخط الزمني", "Sources": "المصادر", "Qualification (100 points)": "التأهيل (100 نقطة)",
  };
  const RTL = { ar: true };
  const S = { lang: "en", obs: null, busy: false };
  const read = () => { try { return localStorage.getItem(KEY) || "en"; } catch (e) { return "en"; } };
  const write = (l) => { try { localStorage.setItem(KEY, l); } catch (e) {} };
  const t = (s) => (S.lang === "ar" && AR[s]) || s;
  const ATTRS = ["placeholder", "title", "aria-label"];
  function tr(node) {
    if (S.lang !== "ar" || !node) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/.test(n.tagName) ? NodeFilter.FILTER_REJECT : n.nodeType === 1 && n.isContentEditable ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const visit = (n) => {
      if (n.nodeType === 3) { const v = n.nodeValue, k = v.trim(); if (k && AR[k]) n.nodeValue = v.replace(k, AR[k]); return; }
      if (n.nodeType === 1) { if (n.tagName === "INPUT" && /^(button|submit)$/i.test(n.type) && AR[n.value]) n.value = AR[n.value];
        for (const a of ATTRS) { const v = n.getAttribute && n.getAttribute(a); if (v && AR[v.trim()]) n.setAttribute(a, AR[v.trim()]); } }
    };
    visit(node); let n; while ((n = w.nextNode())) visit(n);
  }
  function applyDir() {
    const h = document.documentElement; h.lang = S.lang; h.dir = RTL[S.lang] ? "rtl" : "ltr";
    if (S.obs) { S.obs.disconnect(); S.obs = null; }
    if (S.lang === "ar" && root.MutationObserver) {
      S.obs = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) tr(n.nodeType === 3 ? n.parentNode : n); });
      S.obs.observe(document.body, { childList: true, subtree: true });
      tr(document.body);
    }
  }
  /** Change the interface language. Re-renders the current page so text written in English is replaced cleanly. */
  async function setLang(l, { persist = true } = {}) {
    const was = S.lang; S.lang = l === "ar" ? "ar" : "en"; write(S.lang);
    if (persist && root.DPStore && DPStore.st && DPStore.st.userId) DPStore.set(`data/users/${DPStore.st.userId}/ui`, { lang: S.lang, at: new Date().toISOString() }).catch(() => {});
    // back to English: reload, so every piece of text is drawn fresh in English; to Arabic: translate in place
    if (was === "ar" && S.lang === "en") { setTimeout(() => location.reload(), 150); return; }
    applyDir();
  }
  /** After sign-in: the person's saved choice wins over this browser's. */
  async function loadPref() { try { const p = root.DPStore && DPStore.st.userId ? await DPStore.tryGet(`data/users/${DPStore.st.userId}/ui`) : null; if (p && p.lang && p.lang !== S.lang) { S.lang = p.lang; write(p.lang); applyDir(); } } catch (e) {} }
  function init() { S.lang = read(); if (document.body) applyDir(); else document.addEventListener("DOMContentLoaded", applyDir); }
  const toggleHtml = () => `<button type="button" class="ri" id="r-lang" title="${S.lang === "ar" ? "English" : "العربية"}"><span class="lang-ic" aria-hidden="true">${S.lang === "ar" ? "EN" : "ع"}</span><span>${S.lang === "ar" ? "English" : "العربية"}</span></button>`;
  init();
  root.DPI18n = { AR, t, tr, setLang, loadPref, toggleHtml, get lang() { return S.lang; }, isRtl: () => !!RTL[S.lang] };
})(typeof self !== "undefined" ? self : this);
