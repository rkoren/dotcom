// CBB gameday predictions

var BASE = "https://reilly-cbb-model-data.s3.us-east-1.amazonaws.com/public"; // bucket
var LATEST_URL = BASE + "/latest.json";

var index = null; // index.json for the active season
var season = null;
var games = []; // games for the selected date */
var shown = []; // filtered games
var sortState = null;
var slateCache = {};  // date -> games to keep slate

// flatten nested game predictions
function flatten(g) {
  return {
    matchup: g.home === "a" ? g.b + " @ " + g.a
           : g.home === "b" ? g.a + " @ " + g.b
           : g.a + " vs " + g.b,
    gender: g.gender,
    ourA: g.our && g.our.a, ourB: g.our && g.our.b,
    ourMargin: g.our && g.our.margin,
    ourProb: g.our && g.our.prob,
    kpMargin: g.kp && g.kp.margin,
    gapMargin: g.gap_margin,
    actualA: g.actual && g.actual.a, actualB: g.actual && g.actual.b,
    actualMargin: g.actual && g.actual.margin,
    won: g.actual ? g.actual.won : null,
  };
}

function score(a, b) {
  return a === null || a === undefined || b === null || b === undefined ? "" : a + "&ndash;" + b;
}

// check if we got winner right
function call(r) {
  if (r.won === null || r.won === undefined || r.ourMargin === null || r.ourMargin === undefined) {
    return "";
  }
  return (r.ourMargin > 0) === (r.won === 1)
    ? '<span class="muted">hit</span>'
    : '<span class="jeopardy">miss</span>';
}

function drawRows() {
  var tbody = el("rows");
  tbody.innerHTML = "";
  shown.forEach(function (r) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + r.matchup + "</td>" +
      '<td class="muted">' + r.gender + "</td>" +
      '<td class="num">' + score(r.ourA, r.ourB) + "</td>" +
      '<td class="num">' + (r.ourMargin === null ? "" : num(r.ourMargin, 1)) + "</td>" +
      '<td class="num">' + (r.kpMargin === null || r.kpMargin === undefined ? "" : num(r.kpMargin, 1)) + "</td>" +
      '<td class="num">' + (r.gapMargin === null || r.gapMargin === undefined ? "" : num(r.gapMargin, 1)) + "</td>" +
      '<td class="num">' + (r.ourProb === null || r.ourProb === undefined ? "" : Math.round(r.ourProb * 100) + "%") + "</td>" +
      '<td class="num">' + score(r.actualA, r.actualB) + "</td>" +
      "<td>" + call(r) + "</td>";
    tbody.appendChild(tr);
  });
  el("count").textContent = shown.length + " of " + games.length + " games";
}

function applyFilters() {
  var g = el("gender").value;
  var kpOnly = el("kponly").checked;
  shown = games.map(flatten).filter(function (r) {
    if (g && r.gender !== g) return false;
    if (kpOnly && (r.kpMargin === null || r.kpMargin === undefined)) return false;
    return true;
  });
  if (sortState && sortState.key) sortRows(shown, sortState.key, sortState.dir);
  else {
    // show biggest disagreements first
    shown.sort(function (a, b) {
      return Math.abs(b.gapMargin || 0) - Math.abs(a.gapMargin || 0);
    });
  }
  drawRows();
}

function renderMetrics(metrics) {
  var box = el("metrics");
  if (!metrics || !metrics.groups) { box.innerHTML = ""; return; }
  var t = [];
  metrics.groups.forEach(function (grp) {
    t.push("<table><thead><tr><th class='nosort'>" + grp.name + "</th>" +
      "<th class='nosort num'>Games</th>" +
      "<th class='nosort num'>Our margin err</th><th class='nosort num'>KP margin err</th>" +
      "<th class='nosort num'>Our Brier</th><th class='nosort num'>KP Brier</th>" +
      "<th class='nosort num'>Our acc</th><th class='nosort num'>KP acc</th></tr></thead><tbody>");
    grp.rows.forEach(function (r) {
      var u = r.us || {}, k = r.kp || {};
      // lower margin of error and Brier is better
      function best(mine, theirs, lowerWins) {
        if (mine === null || theirs === null || mine === undefined || theirs === undefined) return "";
        var win = lowerWins ? mine < theirs : mine > theirs;
        return win ? "<strong>" + mine + "</strong>" : String(mine);
      }
      t.push("<tr><td>" + r.label + "</td>" +
        '<td class="num">' + (r.n || 0).toLocaleString() + "</td>" +
        '<td class="num">' + best(u.margin, k.margin, true) + "</td>" +
        '<td class="num">' + best(k.margin, u.margin, true) + "</td>" +
        '<td class="num">' + best(u.brier, k.brier, true) + "</td>" +
        '<td class="num">' + best(k.brier, u.brier, true) + "</td>" +
        '<td class="num">' + best(u.acc, k.acc, false) + "</td>" +
        '<td class="num">' + best(k.acc, u.acc, false) + "</td>" +
        "</tr>");
    });
    t.push("</tbody></table>");
  });
  box.innerHTML = t.join("");
}

function selectDate(d) {
  if (slateCache[d]) {
    games = slateCache[d];
    applyFilters();
    return Promise.resolve();
  }
  var url = BASE + "/season=" + season + "/slate/" + d + ".json";
  return fetchJSON(url)
    .then(function (s) {
      slateCache[d] = s.games || [];
      games = slateCache[d];
      applyFilters();
    })
    .catch(function (err) { showError(err, url); });
}

function step(delta) {
  var sel = el("date");
  var i = sel.selectedIndex + delta;
  if (i < 0 || i >= sel.options.length) return;
  sel.selectedIndex = i;
  selectDate(sel.value);
}

function render(idx) {
  index = idx;
  var dates = idx.dates || [];
  var sel = el("date");
  sel.innerHTML = "";
  dates.forEach(function (d) {
    var o = document.createElement("option");
    o.value = d; o.textContent = d;
    sel.appendChild(o);
  });
  // select newest night
  sel.selectedIndex = dates.length - 1;

  el("seasonnote").textContent =
    "Season " + idx.season + " archive — " + (idx.meta.n_games || 0).toLocaleString() +
    " games across " + dates.length + " dates, " +
    (idx.meta.n_compared || 0).toLocaleString() + " with a KenPom line.";
  el("metricsnote").textContent =
    "Scored on the " + (idx.meta.n_compared || 0).toLocaleString() +
    " games KenPom also priced. Margin error is mean absolute; Brier is on win probability" +
    " (lower is better); accuracy is straight win/loss. Better of the two is bold.";
  renderMetrics(idx.metrics);
  renderUpdated("updated", idx.generatedAt);

  if (!sortState) {
    sortState = makeSortable(el("board"), function () { return shown; }, drawRows);
  }
  hide("loading");
  hide("error");
  show("content");
  return selectDate(sel.value);
}

function boot() {
  fetchJSON(LATEST_URL)
    .then(function (p) {
      season = p.season;
      var url = BASE + "/season=" + season + "/index.json";
      return fetchJSON(url).then(render).catch(function (err) { showError(err, url); });
    })
    .catch(function (err) { showError(err, LATEST_URL); });
}

el("date").addEventListener("change", function () { selectDate(this.value); });
el("prev").addEventListener("click", function () { step(-1); });
el("next").addEventListener("click", function () { step(1); });
["gender", "kponly"].forEach(function (id) {
  el(id).addEventListener("change", applyFilters);
});

boot();
