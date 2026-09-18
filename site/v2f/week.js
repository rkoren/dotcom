/* Vegas to Fantasy — weekly view.

   Reads the precomputed JSON published by `v2f publish` (see publish.py in the
   vegas-to-fantasy repo). No server: the fitting and Monte Carlo already ran
   upstream, so the page only filters, sorts and renders. */

var BASE =
  "https://v2f-674325521451-us-east-1-an.s3.us-east-1.amazonaws.com/v2f/public";
var LATEST_URL = BASE + "/latest.json";

var all = [];        /* every player for the active profile */
var shown = [];      /* after filters — what the table renders, and what sorting mutates */
var sortState = null;
var pointer = null;  /* {season, week} from latest.json */

function weekDir(season, week) {
  var pad = week < 10 ? "0" + week : String(week);
  return BASE + "/season=" + season + "/week=" + pad;
}

function pts(v) { return v === null || v === undefined ? "" : num(v, 1); }

/* Only the flags a reader can act on; the rest are model diagnostics. */
function notes(r) {
  var out = [];
  if (r.incomplete) out.push('<span class="jeopardy">TD only</span>');
  if (r.injury_status) out.push('<span class="live">' + r.injury_status + "</span>");
  if ((r.flags || []).indexOf("book_disagree") >= 0) out.push('<span class="muted">books differ</span>');
  if ((r.books || []).length === 1) out.push('<span class="muted">1 book</span>');
  return out.join(" ");
}

function drawRows() {
  var tbody = el("rows");
  tbody.innerHTML = "";
  shown.forEach(function (r) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="checkbox" data-pid="' + r.player_id + '"' +
        (isSelected(r.player_id) ? " checked" : "") + "></td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + (r.position || "") + "</td>" +
      "<td>" + (r.team || "") + "</td>" +
      "<td>" + (r.opponent || "") + "</td>" +
      '<td class="num"><strong>' + pts(r.total) + "</strong></td>" +
      '<td class="num">' + pts(r.p20) + "</td>" +
      '<td class="num">' + pts(r.p80) + "</td>" +
      "<td>" + notes(r) + "</td>";
    tbody.appendChild(tr);
  });
  el("count").textContent = shown.length + " of " + all.length + " players";
}

function applyFilters() {
  var pos = el("pos").value;
  var teams = el("team").value.toUpperCase().split(/[,\s]+/).filter(Boolean);
  var min = parseFloat(el("minpts").value);
  var hideInc = el("hideincomplete").checked;

  shown = all.filter(function (r) {
    if (pos && r.position !== pos) return false;
    if (teams.length && teams.indexOf((r.team || "").toUpperCase()) < 0) return false;
    if (!isNaN(min) && (r.total || 0) < min) return false;
    if (hideInc && r.incomplete) return false;
    return true;
  });
  if (sortState && sortState.key) sortRows(shown, sortState.key, sortState.dir);
  else shown.sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
  drawRows();
}

function render(season, week, proj, dists) {
  /* The win matrix assumes both files share a bin grid. They are published
     together, but a mismatch would yield a plausible wrong number rather than an
     error, so refuse instead of guessing. */
  if (dists.binWidth !== undefined && proj.profile !== dists.profile) {
    throw new Error(
      "profile mismatch: projections=" + proj.profile + " dists=" + dists.profile
    );
  }
  setDists(dists);
  all = proj.players || [];
  el("weekhdr").textContent =
    "Week " + week + " projections — " + season + " (" + proj.profile + ")";
  renderUpdated("updated", proj.generatedAt);

  if (!sortState) {
    sortState = makeSortable(el("board"), function () { return shown; }, drawRows);
  }
  applyFilters();
  renderCompare();
  renderSearch();   /* `all` was just replaced — rerun against the new profile */

  hide("loading");
  hide("error");
  show("content");
}

function loadProfile() {
  var profile = el("profile").value;
  var dir = weekDir(pointer.season, pointer.week);
  var projUrl = dir + "/projections_" + profile + ".json";
  var distUrl = dir + "/dists_" + profile + ".json";
  return Promise.all([fetchJSON(projUrl), fetchJSON(distUrl)])
    .then(function (r) { render(pointer.season, pointer.week, r[0], r[1]); })
    .catch(function (err) { showError(err, projUrl); });
}

function boot() {
  fetchJSON(LATEST_URL)
    .then(function (p) { pointer = p; return loadProfile(); })
    .catch(function (err) { showError(err, LATEST_URL); });
}

/* Switching scoring reloads both files: points and distributions both change. */
el("profile").addEventListener("change", function () {
  show("loading");
  loadProfile();
});
["pos", "team", "minpts", "hideincomplete"].forEach(function (id) {
  var ev = id === "team" || id === "minpts" ? "input" : "change";
  el(id).addEventListener(ev, applyFilters);
});

/* Checkboxes are re-created on every draw, so listen on the table body. */
el("rows").addEventListener("change", function (e) {
  var pid = e.target && e.target.getAttribute && e.target.getAttribute("data-pid");
  if (!pid) return;
  if (!toggleSelected(pid, e.target.checked)) e.target.checked = false;
  renderCompare();
  renderSearch();   /* an unticked player becomes searchable again */
});

bindSearch();

boot();
