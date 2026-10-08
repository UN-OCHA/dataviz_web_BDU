/**
 * WebGate — the web version's sign-up ("soft gate").
 *
 * The first time someone opens the web version in a browser, they give the
 * same details as the plugin's download form (name, email, organization,
 * duty station). The answer goes to the download form's Apps Script, which
 * keeps web sign-ups on their own tab and emails ochavisual@un.org. The
 * browser then remembers the person, so they are asked once per browser.
 *
 * "I've registered before" asks only for an email; the backend answers yes
 * or no — never anyone's details. Plugin downloads count as registered.
 *
 * It is a SOFT gate: if the sign-up service can't be reached, people get in
 * anyway. The point is knowing who uses the tool, not locking it. While
 * BACKEND_READY is false the screen isn't shown at all.
 *
 * What the browser keeps (localStorage "ocha-dataviz-web:user"): the email
 * and an anonymous user code (a one-way SHA-256 code of the email) used to
 * count unique users. Name, organization and duty station are sent once and
 * not kept here.
 *
 * API: WebGate.whenSignedIn(cb) — cb once the person is signed in (now, or
 * after the form); WebGate.userCode() — the anonymous code, or "";
 * WebGate.sendUsage({ch, v, e, loc, u}) — one usage count.
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

  var STORE_KEY = "ocha-dataviz-web:user";
  var waiting = [];
  var user = load();

  function load() {
    try { var u = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); return u && u.email ? u : null; }
    catch (e) { return null; }
  }
  function save(u) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(u)); } catch (e) { /* private window: ask again next time */ }
  }

  function userCode() { return (user && user.code) || ""; }

  // One usage count → the same Apps Script, "kind": "usage" (it files ch
  // "web" counts on the "Web usage" tab). Fire-and-forget.
  function sendUsage(fields) {
    if (!BACKEND_READY) return;
    var body = { kind: "usage" };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) body[k] = fields[k];
    try { post(body, false).catch(function () {}); } catch (e) { /* offline: drop it */ }
  }

  function whenSignedIn(cb) {
    if (user) cb(); else waiting.push(cb);
  }

  function signedIn(u) {
    user = u;
    save(u);
    var list = waiting; waiting = [];
    list.forEach(function (cb) { try { cb(); } catch (e) { /* a listener's problem stays its own */ } });
  }

  // One-way code of the email (first 16 hex characters of SHA-256). Needs a
  // secure page (https or localhost); elsewhere there is simply no code.
  function codeFor(email) {
    var norm = String(email).trim().toLowerCase();
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve("");
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); })
        .join("").slice(0, 16);
    }, function () { return ""; });
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
          '<h1 id="web-gate-title">Make OCHA charts in your browser</h1>' +
          '<p class="gate-intro">The same charts as the plugin for Adobe Illustrator, no Illustrator needed. ' +
            "Tell us who you are to get started. You'll only be asked once on this browser.</p>" +
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
          '<button type="submit" class="btn btn-primary" id="gate-start">Start making charts</button>' +
          '<button type="button" class="btn-link gate-switch" id="gate-to-returning">I\'ve registered before</button>' +
        "</form>" +
        // ── Registered before ──
        '<form id="gate-returning" novalidate hidden>' +
          "<h1>Welcome back</h1>" +
          '<p class="gate-intro">Enter the email you registered with, for this web version or when you downloaded the plugin.</p>' +
          '<label for="gate-email2">Email <span class="req">*</span></label>' +
          '<input id="gate-email2" type="email" autocomplete="email">' +
          '<p class="gate-error" id="gate-returning-error" role="alert"></p>' +
          '<button type="submit" class="btn btn-primary" id="gate-continue">Continue</button>' +
          '<button type="button" class="btn-link gate-switch" id="gate-to-signup">New here? Sign up</button>' +
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
      btn.textContent = "Getting things ready…";
      var version = (document.getElementById("app-version") || {}).textContent || "";
      var tz = "";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (x) { tz = ""; }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        codeFor(email).then(function (code) {
          hide();
          signedIn({ email: email, code: code, since: new Date().toISOString(), via: "signup" });
        });
      }
      if (BACKEND_READY) {
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
        codeFor(email).then(function (code) {
          hide();
          signedIn({ email: email, code: code, since: new Date().toISOString(), via: "returning" });
        });
      }
      if (!BACKEND_READY) { letIn(); return; }
      var answered = false;
      // Soft gate: if the check can't be done, let the person in.
      var timer = setTimeout(function () { if (!answered) { answered = true; letIn(); } }, 8000);
      post({ kind: "check", email: email }, true).then(function (r) { return r.json(); }).then(function (a) {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        if (a && a.registered) { letIn(); return; }
        btn.disabled = false;
        btn.textContent = "Continue";
        err("gate-returning-error", "We couldn't find that email. Please sign up instead. It only takes a minute.");
      }, function () {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        letIn();
      });
    });
  }

  // Ask on first visit (phones get their own message instead) — but only
  // when sign-ups are actually recorded: never ask people for details that
  // go nowhere. Until then nobody is "signed in", so no usage counts start.
  if (BACKEND_READY && !user && !document.getElementById("web-phone-gate")) show();

  return { whenSignedIn: whenSignedIn, userCode: userCode, sendUsage: sendUsage, collecting: BACKEND_READY };
})();
