/* Vegas to Fantasy — weekly view. Reads precomputed projections published by
   `v2f collect`; no server, no Monte Carlo in the browser. */

var BASE = "https://v2f-674325521451-us-east-1-an.s3.us-east-1.amazonaws.com/v2f/public";
var LATEST_URL = BASE + "/latest.json";

var PUBLISHED = false; /* flips on once the publish step lands (plan step 7) */

var PENDING_NOTE =
  "The projections feed isn't published yet. The collector already runs four times a " +
  "day against S3; the remaining work is a publish step that writes a browser-readable " +
  "JSON to a public prefix. Until then this page is a shell.";

function boot() {
  if (!PUBLISHED) {
    hide("loading");
    el("note").textContent = PENDING_NOTE;
    var e = el("error");
    e.hidden = false;
    e.classList.remove("err");
    e.innerHTML = '<span class="muted">Not published yet — see below.</span>';
    return;
  }
  fetchJSON(LATEST_URL)
    .then(function (p) { return loadWeek(p.season, p.week); })
    .catch(function (err) { showError(err, LATEST_URL); });
}

function loadWeek(season, week) {
  var pad = String(week).length < 2 ? "0" + week : String(week);
  var dir = BASE + "/season=" + season + "/week=" + pad;
  var profile = el("profile").value;
  var projUrl = dir + "/projections_" + profile + ".json";
  return Promise.all([fetchJSON(projUrl), fetchJSON(dir + "/dists.json")])
    .then(function (r) { render(season, week, r[0], r[1]); })
    .catch(function (err) { showError(err, projUrl); });
}

function render(season, week, proj, dists) {
  hide("loading");
  show("content");
  el("weekhdr").textContent = "Week " + week + " projections — " + season;
  renderUpdated("updated", proj.generatedAt);
  /* wired in step 7 */
}

boot();
