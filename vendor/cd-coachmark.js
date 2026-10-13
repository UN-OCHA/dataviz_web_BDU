/* ============================================================================
   OCHA App Kit — cd-coachmark.js  (behaviour for the .cd-coachmark component)
   SOURCE OF TRUTH: app-kit/js/cd-coachmark.js. Apps get a copy through
   sync.py ("scripts" in apps.json) — never edit an app's copy.

   A guided walk-through: dims the page except one element, explains it in a
   small bubble, and moves on with Next (or when the person does the thing
   the step describes). Back, Skip, and Esc to close. No dependencies.

     var tour = CdCoachmark.start({
       steps: [
         { target: "#data-table",            // selector or function → Element
           title: "Your data",               // plain text ("\n" = new line)
           icon: '<img src="…" alt="">',     // optional, above the title (a Humanitarian Icon)
           text: "<p>Type or paste…</p>",    // app-authored HTML (never user input)
           onEnter: function () { … },       // optional; may return a Promise
           advanceOn: { selector: ".chart-type", event: "click" } },  // optional
         …
       ],
       labels: { next, back, done, skip, close, count: "Step {n} of {total}" },
       buttonClass: "…", secondaryButtonClass: "…",   // the app's own buttons
       onStep: function (index) {},                   // optional
       onEnd: function (reason, index) {}             // "done" | "skip" | an action's value
     });

   Intro variant — one centred card over the dimmed page (a welcome):
     CdCoachmark.start({
       variant: "intro", modal: true, closeOnScrim: true, showCount: false,
       steps: [{ title: "New here?", text: "<p>…</p>" }],          // no target
       actions: [{ label: "Start", value: "start", primary: true },
                 { label: "No thanks", value: "no" }],
       onEnd: function (reason) { … }                  // "start" | "no" | "skip"
     });
   modal: focus stays inside the card and starts on the primary action.
   closeOnScrim: a click on the dimmed page closes it (reason "skip").
     tour.next(); tour.back(); tour.end("skip");
     CdCoachmark.active()  → the running tour or null

   Accessibility: the bubble is a labelled dialog that takes focus on each
   step (screen readers read the title and text), a polite live region
   announces "Step n of total", Esc closes, and focus returns to where it was.
   The highlighted element stays usable through the hole in the dim layer.
   A step whose element is missing is shown centred instead of failing.
   ============================================================================ */
var CdCoachmark = (function () {
  "use strict";

  var LABELS = {
    next: "Next", back: "Back", done: "Done", skip: "Skip the guide",
    close: "Close the guide", count: "Step {n} of {total}"
  };
  // Font Awesome Classic Regular "xmark" (UI chrome icons are Font Awesome).
  var XMARK = '<svg viewBox="0 0 640 640" fill="currentColor" aria-hidden="true"><path d="M135.5 169C126.1 159.6 126.1 144.4 135.5 135.1C144.9 125.8 160.1 125.7 169.4 135.1L320.4 286.1L471.4 135.1C480.8 125.7 496 125.7 505.3 135.1C514.6 144.5 514.7 159.7 505.3 169L354.3 320L505.3 471C514.7 480.4 514.7 495.6 505.3 504.9C495.9 514.2 480.7 514.3 471.4 504.9L320.4 353.9L169.4 504.9C160 514.3 144.8 514.3 135.5 504.9C126.2 495.5 126.1 480.3 135.5 471L286.5 320L135.5 169z"/></svg>';
  var PAD = 6;        // space between the element and its outline
  var GAP = 12;       // space between the outline and the bubble
  var EDGE = 12;      // keep the bubble this far from the window edge
  var current = null;
  var uid = 0;

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function resolve(target) {
    if (!target) return null;
    var t = typeof target === "function" ? target() : document.querySelector(target);
    if (!t || !t.isConnected) return null;
    var r = t.getBoundingClientRect();
    return (r.width || r.height) ? t : null;          // not displayed = treat as missing
  }

  function start(opts) {
    if (current) current.end("skip");
    var steps = opts.steps || [];
    if (!steps.length) return null;
    var labels = {};
    Object.keys(LABELS).forEach(function (k) { labels[k] = (opts.labels && opts.labels[k]) || LABELS[k]; });
    var btn = opts.buttonClass || "cd-button cd-button--small";
    var btn2 = opts.secondaryButtonClass || "cd-button cd-button--outline cd-button--small";
    var id = "cd-coachmark-" + (++uid);
    var index = -1, ended = false, lastFocus = document.activeElement, targetEl = null;
    var advanceListener = null, timer = null, seq = 0;

    // ── Markup ──
    var scrim = el("div", "cd-coachmark-scrim", { "aria-hidden": "true" });
    var ring = el("div", "cd-coachmark-ring", { "aria-hidden": "true" });
    var box = el("div", "cd-coachmark" + (opts.variant ? " cd-coachmark--" + opts.variant : ""), {
      role: "dialog", "aria-modal": opts.modal ? "true" : "false", tabindex: "-1",
      "aria-labelledby": id + "-title", "aria-describedby": id + "-text" });
    function attr(t) { return String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
    // Buttons: the app's own actions (intro variant), or Skip · Back · Next.
    var actionsHtml = opts.actions
      ? opts.actions.map(function (a, k) {
          return '<button type="button" class="' + (a.primary ? btn : btn2) + '" data-cm-action="' + k + '">' + attr(a.label) + "</button>";
        }).join("")
      : '<button type="button" class="cd-coachmark__skip">' + labels.skip + "</button>" +
        '<button type="button" class="' + btn2 + '" data-cm="back">' + labels.back + "</button>" +
        '<button type="button" class="' + btn + '" data-cm="next">' + labels.next + "</button>";
    box.innerHTML =
      '<button type="button" class="cd-coachmark__close" aria-label="' + labels.close + '" title="' + labels.close + '">' + XMARK + "</button>" +
      '<div class="cd-coachmark__icon" aria-hidden="true" hidden></div>' +
      '<p class="cd-coachmark__count" id="' + id + '-count"' + (opts.showCount === false ? " hidden" : "") + "></p>" +
      '<h2 class="cd-coachmark__title" id="' + id + '-title"></h2>' +
      '<div class="cd-coachmark__text" id="' + id + '-text"></div>' +
      '<div class="cd-coachmark__actions">' + actionsHtml + "</div>";
    var live = el("div", "cd-coachmark__live", { "aria-live": "polite" });
    var q = function (sel) { return box.querySelector(sel); };
    document.body.appendChild(scrim);
    document.body.appendChild(ring);
    document.body.appendChild(box);
    document.body.appendChild(live);

    q(".cd-coachmark__close").addEventListener("click", function () { end("skip"); });
    if (opts.actions) {
      Array.prototype.forEach.call(box.querySelectorAll("[data-cm-action]"), function (b) {
        b.addEventListener("click", function () { end(opts.actions[+b.getAttribute("data-cm-action")].value); });
      });
    } else {
      q(".cd-coachmark__skip").addEventListener("click", function () { end("skip"); });
      q('[data-cm="back"]').addEventListener("click", function () { go(index - 1); });
      q('[data-cm="next"]').addEventListener("click", function () { go(index + 1); });
    }
    if (opts.closeOnScrim) scrim.addEventListener("click", function () { end("skip"); });
    function focusables() {
      return Array.prototype.filter.call(box.querySelectorAll("button, [href], input, select, textarea"),
        function (n) { return !n.disabled && !n.hidden && n.getClientRects().length > 0; });
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); end("skip"); return; }
      // modal: Tab and Shift+Tab stay inside the card.
      if (opts.modal && e.key === "Tab") {
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);

    // ── Placement ──
    function place() {
      if (ended) return;
      var step = steps[index];
      targetEl = resolve(step && step.target);
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      var bw = box.offsetWidth, bh = box.offsetHeight, x, y;
      if (!targetEl) {
        scrim.style.clipPath = "";
        ring.hidden = true;
        x = (vw - bw) / 2; y = (vh - bh) / 2;
      } else {
        var r = targetEl.getBoundingClientRect();
        var L = Math.max(0, r.left - PAD), T = Math.max(0, r.top - PAD);
        var R = Math.min(vw, r.right + PAD), B = Math.min(vh, r.bottom + PAD);
        // One polygon: the whole window, then the hole (even-odd), so the
        // highlighted element shows through and stays clickable.
        scrim.style.clipPath = "polygon(evenodd, 0 0, " + vw + "px 0, " + vw + "px " + vh + "px, 0 " + vh + "px, 0 0, " +
          L + "px " + T + "px, " + L + "px " + B + "px, " + R + "px " + B + "px, " + R + "px " + T + "px, " + L + "px " + T + "px)";
        ring.hidden = false;
        ring.style.left = L + "px"; ring.style.top = T + "px";
        ring.style.width = (R - L) + "px"; ring.style.height = (B - T) + "px";
        // Below, above, right, left — the first side with room; else centred.
        var spots = [
          { ok: vh - B - GAP >= bh + EDGE, x: L, y: B + GAP },
          { ok: T - GAP >= bh + EDGE, x: L, y: T - GAP - bh },
          { ok: vw - R - GAP >= bw + EDGE, x: R + GAP, y: T },
          { ok: L - GAP >= bw + EDGE, x: L - GAP - bw, y: T }
        ];
        var spot = spots.filter(function (s) { return s.ok; })[0] || { x: (vw - bw) / 2, y: (vh - bh) / 2 };
        x = spot.x; y = spot.y;
      }
      x = Math.min(Math.max(EDGE, x), Math.max(EDGE, vw - bw - EDGE));
      y = Math.min(Math.max(EDGE, y), Math.max(EDGE, vh - bh - EDGE));
      box.style.left = Math.round(x) + "px";
      box.style.top = Math.round(y) + "px";
      if (!box.classList.contains("is-placed")) {
        // From the next frame on, moves between steps glide (CSS).
        requestAnimationFrame(function () { box.classList.add("is-placed"); ring.classList.add("is-placed"); });
      }
    }
    var queued = false;
    function queuePlace() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; place(); });
    }
    window.addEventListener("resize", queuePlace);
    window.addEventListener("scroll", queuePlace, true);
    timer = setInterval(place, 300);      // the app may re-render under the step

    // ── Steps ──
    function setAdvance(step) {
      if (advanceListener) {
        document.removeEventListener(advanceListener.event, advanceListener.fn, true);
        advanceListener = null;
      }
      var a = step.advanceOn;
      if (!a || !a.selector) return;
      var at = index;
      var fn = function (e) {
        if (index !== at || !e.target || !e.target.closest || !e.target.closest(a.selector)) return;
        setTimeout(function () { if (index === at) go(index + 1); }, 0);   // let the app react first
      };
      advanceListener = { event: a.event || "click", fn: fn };
      document.addEventListener(advanceListener.event, fn, true);
    }
    function go(i) {
      if (ended) return;
      if (i >= steps.length) { end("done"); return; }
      if (i < 0) return;
      var my = ++seq;
      index = i;
      var step = steps[i];
      // While the app gets ready for the step (switching a tab, loading data),
      // show nothing half-way: the old text with the new outline.
      box.style.visibility = "hidden";
      ring.style.visibility = "hidden";
      Promise.resolve(step.onEnter ? step.onEnter(api) : null).catch(function () { /* show the step anyway */ })
        .then(function () {
          if (ended || my !== seq) return;
          var count = labels.count.replace("{n}", i + 1).replace("{total}", steps.length);
          q(".cd-coachmark__count").textContent = count;
          q(".cd-coachmark__icon").innerHTML = step.icon || "";
          q(".cd-coachmark__icon").hidden = !step.icon;
          q(".cd-coachmark__title").textContent = step.title || "";
          q(".cd-coachmark__text").innerHTML = step.text || "";
          if (!opts.actions) {
            q('[data-cm="back"]').hidden = i === 0;
            q('[data-cm="next"]').textContent = i === steps.length - 1 ? labels.done : labels.next;
          }
          setAdvance(step);
          var t = resolve(step.target);
          if (t) {
            var r = t.getBoundingClientRect();
            var vh = document.documentElement.clientHeight;
            if (r.top < 0 || r.bottom > vh) t.scrollIntoView({ block: "center", inline: "nearest" });
          }
          place();
          box.style.visibility = "";
          ring.style.visibility = "";
          // The primary action when there is one (intro), else the card itself.
          var firstAction = opts.actions && box.querySelector("[data-cm-action]");
          (opts.actions ? (primaryAction() || firstAction) : box).focus();
          live.textContent = (opts.showCount === false ? "" : count + ": ") + (step.title || "");
          if (opts.onStep) opts.onStep(i);
        });
    }
    function end(reason) {
      if (ended) return;
      ended = true;
      if (advanceListener) document.removeEventListener(advanceListener.event, advanceListener.fn, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", queuePlace);
      window.removeEventListener("scroll", queuePlace, true);
      clearInterval(timer);
      [scrim, ring, box, live].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      if (current === api) current = null;
      if (lastFocus && lastFocus.focus && lastFocus.isConnected) { try { lastFocus.focus(); } catch (e) { /* gone */ } }
      if (opts.onEnd) opts.onEnd(reason || "skip", index);
    }

    function primaryAction() {
      if (!opts.actions) return null;
      for (var k = 0; k < opts.actions.length; k++) {
        if (opts.actions[k].primary) return box.querySelector('[data-cm-action="' + k + '"]');
      }
      return null;
    }

    var api = {
      next: function () { go(index + 1); },
      back: function () { go(index - 1); },
      end: end,
      index: function () { return index; },
      element: function () { return box; }
    };
    current = api;
    go(0);
    return api;
  }

  return { start: start, active: function () { return current; } };
})();
