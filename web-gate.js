/**
 * WebGate — the web version's sign-up ("soft gate"), asked at the first
 * download.
 *
 * Anyone can open the web version and try everything. The first time they
 * DOWNLOAD a chart (SVG, PNG, ZIP) or a map, icon or flag, they are asked
 * for the same details as the plugin's download form (name, email,
 * organization, duty station); the download then continues on its own.
 * "Not now" closes the screen without downloading. Asked once per browser.
 * (Saving a chart's JSON or exporting a theme is never gated: that's the
 * person's own work.)
 *
 * The answer goes to the download form's Apps Script, which keeps web
 * sign-ups on their own tab and emails ochavisual@un.org. "I've registered
 * before" asks only for an email; the backend answers yes or no — never
 * anyone's details. Plugin downloads count as registered.
 *
 * It is a SOFT gate: if the sign-up service can't be reached, the download
 * goes ahead anyway. The point is knowing who uses the tool, not locking it.
 * While BACKEND_READY is false nothing is asked or sent.
 *
 * What the browser keeps (localStorage):
 *   "ocha-dataviz-web:user"    — after sign-up: the email (to skip the form
 *                                next time). Name, organization and duty
 *                                station are sent once and not kept.
 *   "ocha-dataviz-web:browser" — a random anonymous code for this browser,
 *                                sent with usage counts so unique browsers
 *                                can be counted. Not derived from anything
 *                                personal.
 *
 * API: WebGate.requireSignIn(then) — run `then` now if signed up, otherwise
 * after the sign-up; WebGate.userCode() — the browser code;
 * WebGate.isSignedUp(); WebGate.sendUsage({ch, v, e, loc, u, s}).
 */

/* global SIGNUP_LISTS, WEB_ICONS */
/* exported WebGate */

var WebGate = (function () {
  "use strict";

  // The download form's Apps Script (same /exec URL as the form uses).
  var BACKEND = "https://script.google.com/macros/s/AKfycbwIJQcqddcL56rnNWHpl_haJAemtgEncdDlPW2_UUdpR6Hru_V-_XCscTiBl33vYx3H/exec";
  // Switched on once that script knows web sign-ups ("kind": "web-signup")
  // and the "registered before" check ("kind": "check"). While false, the
  // gate works locally but sends nothing: the current script would otherwise
  // file a web sign-up as a plugin download.
  var BACKEND_READY = true;     // download-form script, deployed 8 Oct 2026
  // Only the published site sends anything. Local copies (testing, previews)
  // show the same screens but never write to the sheet: test runs once
  // added counts there.
  var LIVE_SITE = /(^|\.)github\.io$/.test(location.hostname);

  var STORE_KEY = "ocha-dataviz-web:user";
  var BROWSER_KEY = "ocha-dataviz-web:browser";
  var user = load();
  var browserCode = loadBrowserCode();
  var pending = null;            // the download waiting for the sign-up
  var pendingCancel = null;      // …and what to do if the person says "Not now"

  // A random 16-hex code, kept in this browser. Without storage (private
  // window) it lives for this page only.
  function loadBrowserCode() {
    var c = "";
    try { c = localStorage.getItem(BROWSER_KEY) || ""; } catch (e) { c = ""; }
    if (/^[0-9a-f]{16}$/.test(c)) return c;
    var bytes = new Uint8Array(8);
    try { crypto.getRandomValues(bytes); } catch (e) { for (var i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256); }
    c = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    try { localStorage.setItem(BROWSER_KEY, c); } catch (e) { /* page-only */ }
    return c;
  }

  function load() {
    try { var u = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); return u && u.email ? u : null; }
    catch (e) { return null; }
  }
  function save(u) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(u)); } catch (e) { /* private window: ask again next time */ }
  }

  function userCode() { return browserCode; }
  function isSignedUp() { return !!user; }

  // Funnel counts (prompt shown, signed up, not now) — through the same
  // usage counts as everything else, once Analytics is running.
  function funnel(event) {
    if (typeof window.sendAnalyticsPing === "function") window.sendAnalyticsPing(event);
  }

  // One usage count → the same Apps Script, "kind": "usage" (it files ch
  // "web" counts on the "Web usage" tab). Fire-and-forget.
  function sendUsage(fields) {
    if (!BACKEND_READY || !LIVE_SITE) return;
    var body = { kind: "usage" };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) body[k] = fields[k];
    try { post(body, false).catch(function () {}); } catch (e) { /* offline: drop it */ }
  }

  // Run `then` (a download) now if this browser has signed up, otherwise
  // after the sign-up screen. "Not now" drops it.
  function requireSignIn(then, onCancel) {
    if (user || !BACKEND_READY) { then(); return; }
    pending = then;
    pendingCancel = onCancel || null;
    if (el) return;                              // screen already open
    show();
    funnel("gate:shown");
  }

  function signedIn(u, how) {
    user = u;
    save(u);
    funnel("gate:" + how);
    var go = pending; pending = null; pendingCancel = null;
    if (go) { try { go(); } catch (e) { /* the download's problem stays its own */ } }
  }

  function notNow() {
    var cancel = pendingCancel;
    pending = null; pendingCancel = null;
    hide();
    funnel("gate:notnow");
    if (cancel) { try { cancel(); } catch (e) { /* ignore */ } }
  }

  function post(body, readAnswer) {
    // Cookie-less, like the download form: browsers signed into several
    // Google accounts are treated as anonymous (no /u/N/ routing).
    var opts = {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    };
    if (!readAnswer) opts.mode = "no-cors";
    return fetch(BACKEND, opts);
  }

  // ── The screen ───────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function icon(name) {
    return '<svg viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">' +
      (WEB_ICONS[name] || []).map(function (d) { return '<path d="' + d + '"/>'; }).join("") + "</svg>";
  }

  var el;
  function setInert(on) {
    ["main-content", "web-resizer", "web-preview"].forEach(function (id) {
      var n = document.getElementById(id);
      if (!n) return;
      if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert");
    });
  }

  function show() {
    el = document.createElement("div");
    el.id = "web-gate";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "web-gate-title");
    var orgs = SIGNUP_LISTS.organizations.map(function (o) { return '<option value="' + esc(o) + '">'; }).join("");
    var countries = SIGNUP_LISTS.countries.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");
    el.innerHTML =
      '<div class="gate-card">' +
        '<div class="gate-brand">' + icon("chart-simple") + "<span>Humanitarian DataViz Tool <em>web" +
          (document.documentElement.getAttribute("data-channel") === "beta" ? " · beta" : "") + "</em></span></div>" +
        // ── Sign up ──
        '<form id="gate-signup" novalidate>' +
          '<h1 id="web-gate-title">One quick step before your download</h1>' +
          '<p class="gate-intro">Tell us who you are, so we know who uses the tool. ' +
            "You'll only be asked once on this browser, and your download starts right after.</p>" +
          '<label for="gate-name">Full name <span class="req">*</span></label>' +
          '<input id="gate-name" type="text" autocomplete="name">' +
          '<label for="gate-email">Email <span class="req">*</span></label>' +
          '<input id="gate-email" type="email" autocomplete="email">' +
          '<label for="gate-org">Organization <span class="req">*</span></label>' +
          '<input id="gate-org" type="text" list="gate-org-list" autocomplete="off" placeholder="Type to find a UN agency, or enter your organization">' +
          '<datalist id="gate-org-list">' + orgs + "</datalist>" +
          '<label for="gate-country">Duty station — Country <span class="req">*</span></label>' +
          '<select id="gate-country"><option value="" disabled selected>Select a country…</option>' + countries +
            '<option value="__other">Other / not listed…</option></select>' +
          '<input id="gate-country-other" type="text" placeholder="Please specify country or territory" hidden>' +
          '<label for="gate-city">Duty station — City <span class="req">*</span></label>' +
          '<input id="gate-city" type="text" autocomplete="address-level2" placeholder="e.g. Geneva">' +
          '<p class="gate-error" id="gate-signup-error" role="alert"></p>' +
          '<button type="submit" class="btn btn-primary" id="gate-start">Sign up and download</button>' +
          '<div class="gate-links">' +
            '<button type="button" class="btn-link gate-switch" id="gate-to-returning">I\'ve registered before</button>' +
            '<button type="button" class="btn-link gate-switch" id="gate-not-now">Not now</button>' +
          "</div>" +
        "</form>" +
        // ── Registered before ──
        '<form id="gate-returning" novalidate hidden>' +
          "<h1>Welcome back</h1>" +
          '<p class="gate-intro">Enter the email you registered with, for this web version or when you downloaded the plugin.</p>' +
          '<label for="gate-email2">Email <span class="req">*</span></label>' +
          '<input id="gate-email2" type="email" autocomplete="email">' +
          '<p class="gate-error" id="gate-returning-error" role="alert"></p>' +
          '<button type="submit" class="btn btn-primary" id="gate-continue">Continue and download</button>' +
          '<div class="gate-links">' +
            '<button type="button" class="btn-link gate-switch" id="gate-to-signup">New here? Sign up</button>' +
            '<button type="button" class="btn-link gate-switch" id="gate-not-now-2">Not now</button>' +
          "</div>" +
        "</form>" +
        '<p class="gate-note">Your name, email and organization are collected by the OCHA Brand and Design Unit solely to ' +
          "understand who is using the tool. They are processed in line with the UN Personal Data Protection and Privacy " +
          "Principles, kept confidential, and not shared with third parties. The charts and data you make stay in your browser. " +
          'Questions or feedback: <a href="mailto:ochavisual@un.org">ochavisual@un.org</a>.</p>' +
      "</div>";
    document.body.appendChild(el);
    setInert(true);
    wire();
    document.getElementById("gate-name").focus();
  }

  // Escape = "Not now" (nothing is downloaded).
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && el) notNow();
  });

  function hide() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
    setInert(false);
  }

  function $(id) { return document.getElementById(id); }
  function err(which, msg) { $(which).textContent = msg || ""; }
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function wire() {
    $("gate-country").addEventListener("change", function () {
      var other = $("gate-country-other");
      other.hidden = this.value !== "__other";
      if (other.hidden) other.value = ""; else other.focus();
    });
    $("gate-to-returning").addEventListener("click", function () {
      $("gate-signup").hidden = true; $("gate-returning").hidden = false;
      $("gate-email2").value = $("gate-email").value; $("gate-email2").focus();
    });
    $("gate-not-now").addEventListener("click", notNow);
    $("gate-not-now-2").addEventListener("click", notNow);
    $("gate-to-signup").addEventListener("click", function () {
      $("gate-returning").hidden = true; $("gate-signup").hidden = false;
      $("gate-email").value = $("gate-email2").value; $("gate-name").focus();
    });

    $("gate-signup").addEventListener("submit", function (e) {
      e.preventDefault();
      err("gate-signup-error", "");
      var name = $("gate-name").value.trim(), email = $("gate-email").value.trim(), org = $("gate-org").value.trim();
      var country = $("gate-country").value === "__other" ? $("gate-country-other").value.trim() : ($("gate-country").value || "").trim();
      var city = $("gate-city").value.trim();
      if (!name) return err("gate-signup-error", "Please enter your name.");
      if (!EMAIL_RE.test(email)) return err("gate-signup-error", "Please enter a valid email address.");
      if (!org) return err("gate-signup-error", "Please enter your organization.");
      if (!country) return err("gate-signup-error", "Please select or specify your duty station country.");
      if (!city) return err("gate-signup-error", "Please enter your duty station city.");
      var btn = $("gate-start");
      btn.disabled = true;
      btn.textContent = "Getting your download ready…";
      var version = (document.getElementById("app-version") || {}).textContent || "";
      var tz = "";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (x) { tz = ""; }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        hide();
        signedIn({ email: email, since: new Date().toISOString(), via: "signup" }, "signup");
      }
      if (BACKEND_READY && LIVE_SITE) {
        try {
          post({ kind: "web-signup", name: name, email: email, org: org, country: country, city: city,
            version: version, timeZone: tz }, false).then(finish, finish);
        } catch (x) { finish(); }
        setTimeout(finish, 2500);        // never keep people waiting on the service
      } else {
        finish();
      }
    });

    $("gate-returning").addEventListener("submit", function (e) {
      e.preventDefault();
      err("gate-returning-error", "");
      var email = $("gate-email2").value.trim();
      if (!EMAIL_RE.test(email)) return err("gate-returning-error", "Please enter a valid email address.");
      var btn = $("gate-continue");
      btn.disabled = true;
      btn.textContent = "Checking…";
      function letIn() {
        hide();
        signedIn({ email: email, since: new Date().toISOString(), via: "returning" }, "returning");
      }
      if (!BACKEND_READY || !LIVE_SITE) { letIn(); return; }
      var answered = false;
      // Soft gate: if the check can't be done, let the person in.
      var timer = setTimeout(function () { if (!answered) { answered = true; letIn(); } }, 8000);
      post({ kind: "check", email: email }, true).then(function (r) { return r.json(); }).then(function (a) {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        if (a && a.registered) { letIn(); return; }
        btn.disabled = false;
        btn.textContent = "Continue and download";
        err("gate-returning-error", "We couldn't find that email. Please sign up instead. It only takes a minute.");
      }, function () {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        letIn();
      });
    });
  }

  return { requireSignIn: requireSignIn, userCode: userCode, isSignedUp: isSignedUp,
    sendUsage: sendUsage, collecting: BACKEND_READY, liveSite: LIVE_SITE };
})();
