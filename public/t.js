/*!
 * Silverback Metrics tracking snippet.
 * Install: <script async src="https://APP_HOST/t.js" data-site="SITE_KEY"></script>
 *
 * - Gives each visitor a random ID (no personal info in cookies).
 * - Records first touch and last non-direct touch (UTMs, click IDs, referrer, landing page).
 * - Fills hidden form fields (sb_data, plus optional utm_* / gclid fields).
 * - Sends pageview, tel: click and backup form-submit beacons to /api/collect.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var SITE = script.getAttribute("data-site");
  if (!SITE) return;
  var ENDPOINT = script.src.replace(/\/t\.js(\?.*)?$/, "") + "/api/collect";

  var STORE_KEY = "_sbm";
  var COOKIE_DAYS = 400;
  var SESSION_MS = 30 * 60 * 1000;
  var PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "gbraid", "wbraid", "fbclid", "msclkid"];

  // ---------- storage helpers ----------
  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, value) {
    var exp = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString();
    var host = location.hostname.replace(/^www\./, "");
    var domain = /^[\d.]+$/.test(host) || host.indexOf(".") === -1 ? "" : "; domain=." + host;
    document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + exp + "; path=/; SameSite=Lax" + domain;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (!raw) raw = readCookie(STORE_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function save(state) {
    var raw = JSON.stringify(state);
    try { localStorage.setItem(STORE_KEY, raw); } catch (e) {}
    // Cookie keeps only what fits comfortably (IDs + touches).
    try { writeCookie(STORE_KEY, raw.length < 3500 ? raw : JSON.stringify({ vid: state.vid, sid: state.sid, sts: state.sts })); } catch (e) {}
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ---------- touch detection ----------
  function currentTouch() {
    var q = new URLSearchParams(location.search);
    var t = { ts: new Date().toISOString(), landing: location.href.split("#")[0] };
    var hasParams = false;
    for (var i = 0; i < PARAMS.length; i++) {
      var v = q.get(PARAMS[i]);
      if (v) { t[PARAMS[i]] = v.slice(0, 300); hasParams = true; }
    }
    var ref = document.referrer;
    var external = false;
    if (ref) {
      try {
        var rh = new URL(ref).hostname.replace(/^www\./, "");
        external = rh !== location.hostname.replace(/^www\./, "");
      } catch (e) {}
    }
    if (external) t.referrer = ref.slice(0, 500);
    t.direct = !hasParams && !external;
    // Return a touch only when this is a new arrival (params or outside referrer).
    return hasParams || external ? t : null;
  }

  var now = Date.now();
  var state = load() || {};
  var isNewVisitor = !state.vid;
  if (!state.vid) state.vid = uid();
  var newSession = !state.sid || !state.sts || now - state.sts > SESSION_MS;
  if (newSession) state.sid = uid();
  state.sts = now;

  var touch = currentTouch();
  if (!touch && isNewVisitor) {
    touch = { ts: new Date().toISOString(), landing: location.href.split("#")[0], direct: true };
  }
  if (touch) {
    if (!state.ft) state.ft = touch;            // first touch never changes
    if (!touch.direct || !state.lt) state.lt = touch; // last non-direct touch
  }
  save(state);

  function gaClientId() {
    var c = readCookie("_ga");
    if (!c) return null;
    var parts = c.split(".");
    return parts.length >= 4 ? parts[2] + "." + parts[3] : null;
  }

  // ---------- beacons ----------
  function send(type, data) {
    var body = JSON.stringify({
      k: SITE, type: type, vid: state.vid, sid: state.sid,
      url: location.href, title: document.title, ga: gaClientId(),
      touch: type === "pageview" ? touch : undefined,
      ft: isNewVisitor && type === "pageview" ? state.ft : undefined,
      data: data
    });
    // text/plain avoids a CORS preflight.
    var blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
    try { fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, mode: "no-cors" }); } catch (e) {}
  }

  // ---------- form filling ----------
  function attributionPayload() {
    return JSON.stringify({ v: 1, vid: state.vid, sid: state.sid, ga: gaClientId(), ft: state.ft, lt: state.lt });
  }
  var reportedField = false;
  function fillForms() {
    var payload = attributionPayload();
    var filled = 0;
    var main = document.querySelectorAll('input[name="form_fields[sb_data]"], input[name="sb_data"], input.sb-data');
    for (var i = 0; i < main.length; i++) { main[i].value = payload; filled++; }
    // Optional individual fields, e.g. Elementor hidden field with ID "utm_source".
    var src = state.lt || state.ft || {};
    for (var j = 0; j < PARAMS.length; j++) {
      var p = PARAMS[j];
      if (!src[p]) continue;
      var els = document.querySelectorAll('input[type="hidden"][name="form_fields[' + p + ']"], input[type="hidden"][name="' + p + '"]');
      for (var k = 0; k < els.length; k++) if (!els[k].value) els[k].value = src[p];
    }
    if (filled && !reportedField) { reportedField = true; send("field_found", { count: filled }); }
  }

  // ---------- listeners ----------
  function onReady(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  onReady(function () {
    send("pageview");
    fillForms();
    if (window.MutationObserver) {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; fillForms(); }, 250);
      }).observe(document.body, { childList: true, subtree: true });
    }
  });

  // Fill again right before any submit (covers forms rendered late).
  document.addEventListener("submit", function (e) {
    fillForms();
    var form = e.target;
    if (!form || form.tagName !== "FORM") return;
    // Backup copy of the submission (webhook is the source of truth).
    var fields = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.name || el.type === "password" || el.type === "file") continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      if (/card|cc-|cvv|ssn/i.test(el.name)) continue;
      fields[el.name] = String(el.value).slice(0, 2000);
    }
    send("form_submit", { form_id: form.id || form.getAttribute("name") || null, fields: fields });
  }, true);

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if (a) send("tel_click", { number: a.getAttribute("href").slice(4) });
  }, true);

  window.SilverbackMetrics = { visitorId: state.vid, attribution: function () { return JSON.parse(attributionPayload()); } };
})();
