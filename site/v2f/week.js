// weekly view

var BASE =
  "https://v2f-674325521451-us-east-1-an.s3.us-east-1.amazonaws.com/v2f/public";
var LATEST_URL = BASE + "/latest.json";

var all = []; // all players with odds
var shown = []; // add players after filters
var sortState = null;
var pointer = null; // {season, week} from latest.json

function weekDir(season, week) {
  var pad = week < 10 ? "0" + week : String(week);
  return BASE + "/season=" + season + "/week=" + pad;
}

function pts(v) { return v === null || v === undefined ? "" : num(v, 1); }

// stats columns
var STAT_COLS = [
  ["pass_yds", 0, "pass yds"], ["pass_tds", 1, "pass TD"], ["pass_int", 1, "INT"],
  ["rush_att", 1, "carries"],  ["rush_yds", 0, "rush yds"],
  ["rec", 1, "rec"],           ["rec_yds", 0, "rec yds"],
  ["any_td", 1, "TD"]
];

var expanded = new Set();

function statLine(r) {
  return STAT_COLS.filter(function (c) {
    var v = r["s_" + c[0]];
    return v !== null && v !== undefined && v !== 0;
  }).map(function (c) {
    return num(r["s_" + c[0]], c[1]) + " " + c[2];
  }).join(" &middot; ");
}

function detailRow(r) {
  var tr = document.createElement("tr");
  tr.className = "detail";
  tr.innerHTML = '<td colspan="' + (10 + STAT_COLS.length) + '">' +
    "<strong>" + r.name + "</strong> " +
    '<span class="muted">' + [r.position, r.team, r.opponent].filter(Boolean).join(" ") + "</span>" +
    " &mdash; " + (statLine(r) || '<span class="muted">no stats priced</span>') +
    (r.incomplete ? " <span class='jeopardy'>TD only</span>" : "") + "</td>";
  return tr;
}

// mark off stats that aren't applied to players
function statCell(v, dp) {
  return v === null || v === undefined || v === 0 ? "" : num(v, dp);
}

// make sortable by flattening
function flattenStats(rows) {
  rows.forEach(function (r) {
    var st = r.stats || {};
    STAT_COLS.forEach(function (c) { r["s_" + c[0]] = st[c[0]] === undefined ? null : st[c[0]]; });
  });
}

// A player's actual score with shading based on the projection
function actualCell(r) {
  if (r.actual === null || r.actual === undefined) return "";
  var beat = (r.total || 0) > 0 && r.actual >= r.total;
  return '<span class="' + (beat ? "live" : "muted") + '">' + num(r.actual, 1) + "</span>";
}

// player notes column
function notes(r) {
  var out = [];
  if (r.played) out.push('<span class="muted">played</span>');
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
      '<td><a href="#" class="pname" data-expand="' + r.player_id + '">' + r.name + "</a></td>" +
      "<td>" + (r.position || "") + "</td>" +
      "<td>" + (r.team || "") + "</td>" +
      "<td>" + (r.opponent || "") + "</td>" +
      '<td class="num"><strong>' + pts(r.total) + "</strong></td>" +
      '<td class="num">' + actualCell(r) + "</td>" +
      '<td class="num">' + pts(r.p20) + "</td>" +
      '<td class="num">' + pts(r.p80) + "</td>" +
      STAT_COLS.map(function (c) {
        return '<td class="num stat">' + statCell(r["s_" + c[0]], c[1]) + "</td>";
      }).join("") +
      "<td>" + notes(r) + "</td>";
    tbody.appendChild(tr);
    if (expanded.has(r.player_id)) tbody.appendChild(detailRow(r));
  });
  el("count").textContent = shown.length + " of " + all.length + " players";
}

function applyFilters() {
  var pos = el("pos").value;
  var teams = el("team").value.toUpperCase().split(/[,\s]+/).filter(Boolean);
  var min = parseFloat(el("minpts").value);
  var hideInc = el("hideincomplete").checked;
  var hidePlayed = el("hideplayed").checked;

  shown = all.filter(function (r) {
    if (pos && r.position !== pos) return false;
    if (teams.length && teams.indexOf((r.team || "").toUpperCase()) < 0) return false;
    if (!isNaN(min) && (r.total || 0) < min) return false;
    if (hideInc && r.incomplete) return false;
    if (hidePlayed && r.played) return false;
    return true;
  });
  if (sortState && sortState.key) sortRows(shown, sortState.key, sortState.dir);
  else shown.sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
  drawRows();
}

function render(season, week, proj, dists) {
  if (dists.binWidth !== undefined && proj.profile !== dists.profile) {
    throw new Error(
      "profile mismatch: projections=" + proj.profile + " dists=" + dists.profile
    );
  }
  setDists(dists);
  all = proj.players || [];
  flattenStats(all);
  buildSearchIndex(all);
  el("weekhdr").textContent =
    "Week " + week + " projections — " + season + " (" + proj.profile + ")";
  renderUpdated("updated", proj.generatedAt);

  if (!sortState) {
    sortState = makeSortable(el("board"), function () { return shown; }, drawRows);
  }
  applyFilters();
  renderPicked();
  renderSearch();
  renderCompare();

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

// switching scoring reloads
el("profile").addEventListener("change", function () {
  show("loading");
  loadProfile();
});
["pos", "team", "minpts", "hideincomplete", "hideplayed"].forEach(function (id) {
  var ev = id === "team" || id === "minpts" ? "input" : "change";
  el(id).addEventListener(ev, applyFilters);
});

el("rows").addEventListener("click", function (e) {
  var pid = e.target && e.target.getAttribute && e.target.getAttribute("data-expand");
  if (!pid) return;
  e.preventDefault();
  if (expanded.has(pid)) expanded.delete(pid); else expanded.add(pid);
  drawRows();
});

el("rows").addEventListener("change", function (e) {
  var pid = e.target && e.target.getAttribute && e.target.getAttribute("data-pid");
  if (!pid) return;
  if (!toggleSelected(pid, e.target.checked)) e.target.checked = false;
  refreshSelection();
});

bindSearch();

boot();
