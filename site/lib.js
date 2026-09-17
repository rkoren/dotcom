/* Shared helpers. Every page gets loading / error / stale states so a failed
   fetch never renders a blank white page. See CLAUDE.md. */

function el(id) { return document.getElementById(id); }

function show(id) { var n = el(id); if (n) n.hidden = false; }
function hide(id) { var n = el(id); if (n) n.hidden = true; }

/* Fetch JSON, surfacing the URL on failure so a broken pipeline is diagnosable
   from the page itself rather than the console. */
function fetchJSON(url) {
  return fetch(url, { cache: "no-cache" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
    return res.json();
  });
}

function showError(err, url) {
  hide("loading");
  var n = el("error");
  if (!n) return;
  n.hidden = false;
  n.innerHTML = "";
  var p = document.createElement("p");
  p.textContent = "Couldn't load data: " + (err && err.message ? err.message : err);
  var c = document.createElement("code");
  c.textContent = url;
  n.appendChild(p);
  n.appendChild(c);
}

/* "updated 4m ago" — makes a dead pipeline obvious at a glance. */
function agoText(iso) {
  if (!iso) return "";
  var then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  var secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  var s;
  if (secs < 60) s = secs + "s ago";
  else if (secs < 3600) s = Math.round(secs / 60) + "m ago";
  else if (secs < 86400) s = Math.round(secs / 3600) + "h ago";
  else s = Math.round(secs / 86400) + "d ago";
  return "updated " + s + " (" + new Date(iso).toLocaleString() + ")";
}

function renderUpdated(id, iso) {
  var n = el(id);
  if (n) n.textContent = agoText(iso);
}

/* Naive YYYY-MM-DD dates must be parsed component-wise. `new Date("2026-09-02")`
   parses as UTC midnight and renders as the previous day west of Greenwich. */
function parseDay(s) {
  if (!s) return null;
  var p = String(s).split("-");
  if (p.length !== 3) return null;
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function fmtDay(s) {
  var d = parseDay(s);
  if (!d) return s || "";
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function num(v, dp) {
  if (v === null || v === undefined || v === "") return "";
  var n = Number(v);
  return isNaN(n) ? "" : n.toFixed(dp === undefined ? 1 : dp);
}

/* Sort an array of row objects in place. */
function sortRows(rows, key, dir) {
  rows.sort(function (a, b) {
    var x = a[key], y = b[key];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y)) * dir;
  });
}

/* Click-to-sort on any <th data-key>.

   Bind ONCE at boot, not per render. `getRows` is a callback returning the
   current array, so arriving data never needs a re-bind — re-binding would
   stack a duplicate listener on every header each poll (60/hour on the idle
   path), making one click run the sort dozens of times with unpredictable
   direction. Returns the sort state so callers can re-apply the user's active
   sort to fresh data. */
function makeSortable(table, getRows, redraw) {
  var state = { key: null, dir: 1 };
  table.querySelectorAll("th[data-key]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-key");
      if (state.key === k) state.dir = -state.dir;
      else { state.key = k; state.dir = th.classList.contains("num") ? -1 : 1; }
      sortRows(getRows(), state.key, state.dir);
      redraw();
    });
  });
  return state;
}
