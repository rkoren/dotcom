/* Head-to-head compare, computed entirely in the browser.

   The API builds its pairwise win matrix from per-player Monte Carlo samples drawn
   with independent seeds, and reports it as "independent between players". Under
   that same assumption P(A beats B) is recoverable from the two players'
   histograms alone:

     P(A > B) = sum_i histA[i] * (sum_{j<i} histB[j])  +  0.5 * sum_i histA[i] * histB[i]

   So publishing one histogram per player makes ANY subset comparable, instead of
   needing a server round-trip per combination.

   Approximation: the server compares raw float samples, this compares 1-point bins,
   so ties inside a bin take 0.5 weight. Measured against /api/compare on the week-2
   top 8: mean 0.35pt, worst 0.95pt. Halve binWidth upstream if that ever matters. */

var MAX_COMPARE = 8;
var selected = [];   /* player_ids, in pick order */
var dists = null;    /* the dists_<profile>.json payload */

function setDists(d) { dists = d; }
function isSelected(pid) { return selected.indexOf(pid) >= 0; }

/* Returns false when the pick was rejected, so the caller can untick the box. */
function toggleSelected(pid, on) {
  var i = selected.indexOf(pid);
  if (on) {
    if (i >= 0) return true;
    if (selected.length >= MAX_COMPARE) return false;
    selected.push(pid);
  } else if (i >= 0) {
    selected.splice(i, 1);
  }
  return true;
}

function selectionFull() { return selected.length >= MAX_COMPARE; }

function beats(histA, histB) {
  /* Iterate the longer grid: if histB ran past histA, B's tail mass would be
     dropped and P(A>B) overstated. Published histograms share a bin grid, so
     this is belt-and-braces. */
  var n = Math.max(histA.length, histB.length);
  var cum = 0, p = 0;
  for (var i = 0; i < n; i++) {
    var a = histA[i] || 0, b = histB[i] || 0;
    p += a * cum + 0.5 * a * b;
    cum += b;
  }
  return p;
}

/* P(points >= threshold) straight off the histogram. */
function atLeast(hist, threshold, binWidth) {
  var from = Math.ceil(threshold / binWidth);
  var p = 0;
  for (var i = from; i < hist.length; i++) p += hist[i];
  return p;
}

function pctile(hist, q, binWidth) {
  var cum = 0;
  for (var i = 0; i < hist.length; i++) {
    cum += hist[i];
    if (cum >= q) return (i + 0.5) * binWidth;
  }
  return hist.length * binWidth;
}

function rowsById() {
  var m = {};
  all.forEach(function (r) { m[r.player_id] = r; });
  return m;
}

function renderCompare() {
  var box = el("compare");
  var hint = el("cmphint");
  box.innerHTML = "";

  if (selected.length < 2) {
    hint.textContent =
      selected.length === 0
        ? "Search for a player, or tick one in the table below (up to " + MAX_COMPARE + ")."
        : "Tick or search one more player to compare.";
    return;
  }
  hint.innerHTML =
    selected.length + " selected (max " + MAX_COMPARE + "). " +
    '<a href="#" id="clearcmp">clear</a>';

  var byId = rowsById();
  var bw = (dists && dists.binWidth) || 1;
  var picks = selected.filter(function (p) { return dists && dists.hist[p]; });
  var missing = selected.filter(function (p) { return !(dists && dists.hist[p]); });

  if (picks.length < 2) {
    box.innerHTML = '<p class="sub">Not enough distribution data for the selected players.</p>';
    return;
  }

  /* Transposed: players as columns, metrics as rows. */
  var metrics = [
    ["Projected", function (r, h) { return num(r.total, 1); }],
    ["Floor (p20)", function (r, h) { return num(pctile(h, 0.2, bw), 1); }],
    ["Median (p50)", function (r, h) { return num(pctile(h, 0.5, bw), 1); }],
    ["Ceiling (p80)", function (r, h) { return num(pctile(h, 0.8, bw), 1); }],
    ["P(15+ pts)", function (r, h) { return Math.round(atLeast(h, 15, bw) * 100) + "%"; }],
    ["P(20+ pts)", function (r, h) { return Math.round(atLeast(h, 20, bw) * 100) + "%"; }],
    ["P(25+ pts)", function (r, h) { return Math.round(atLeast(h, 25, bw) * 100) + "%"; }]
  ];

  var t = ["<table><thead><tr><th class='nosort'>&nbsp;</th>"];
  picks.forEach(function (p) {
    var r = byId[p] || { name: p };
    t.push("<th class='nosort'>" + r.name +
      "<br><span class='muted'>" + (r.position || "") + " " + (r.team || "") + "</span></th>");
  });
  t.push("</tr></thead><tbody>");
  metrics.forEach(function (m) {
    t.push("<tr><td>" + m[0] + "</td>");
    picks.forEach(function (p) {
      t.push("<td class='num'>" + m[1](byId[p] || {}, dists.hist[p]) + "</td>");
    });
    t.push("</tr>");
  });
  t.push("</tbody></table>");

  /* Pairwise win probabilities. */
  t.push("<h2>Chance the row player outscores the column player</h2>");
  t.push("<table><thead><tr><th class='nosort'>&nbsp;</th>");
  picks.forEach(function (p) {
    t.push("<th class='nosort'>" + ((byId[p] || {}).name || p) + "</th>");
  });
  t.push("</tr></thead><tbody>");
  picks.forEach(function (a) {
    t.push("<tr><td>" + ((byId[a] || {}).name || a) + "</td>");
    picks.forEach(function (b) {
      if (a === b) { t.push("<td class='num muted'>&mdash;</td>"); return; }
      var v = beats(dists.hist[a], dists.hist[b]);
      var cell = Math.round(v * 100) + "%";
      t.push("<td class='num'>" + (v > 0.5 ? "<strong>" + cell + "</strong>" : cell) + "</td>");
    });
    t.push("</tr>");
  });
  t.push("</tbody></table>");

  t.push('<p class="sub">From ' + (dists.draws || "?") +
    " Monte Carlo draws per player, independent between players, binned to " +
    bw + " point" + (bw === 1 ? "" : "s") + ".</p>");

  if (missing.length) {
    t.push('<p class="sub">No distribution published for ' + missing.length +
      " selected player(s).</p>");
  }
  box.innerHTML = t.join("");

  var clear = el("clearcmp");
  if (clear) clear.addEventListener("click", function (e) {
    e.preventDefault();
    selected = [];
    drawRows();
    renderCompare();
    renderSearch();
  });
}


/* ---------------------------------------------------------------- player search

   Every player for the active profile is already in memory, so this filters locally
   rather than calling an API. Its real purpose is reaching players the table's
   filters have hidden: with "Position: QB" set you can still search a running back
   and compare across them. Searching therefore ignores the filters entirely. */

var MAX_RESULTS = 8;

function searchMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  var terms = q.split(/\s+/);
  return all.filter(function (r) {
    if (isSelected(r.player_id)) return false;   /* already picked — nothing to add */
    var hay = ((r.name || "") + " " + (r.position || "") + " " + (r.team || "")).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  }).sort(function (a, b) {
    /* Someone typing a name wants the player they meant, and among near-matches the
       higher-projected one is the likelier intent. */
    var an = (a.name || "").toLowerCase(), bn = (b.name || "").toLowerCase();
    var aStarts = an.indexOf(terms[0]) === 0, bStarts = bn.indexOf(terms[0]) === 0;
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return (b.total || 0) - (a.total || 0);
  });
}

function addFromSearch(pid) {
  if (!toggleSelected(pid, true)) return;
  drawRows();        /* keep the table's checkboxes in step */
  renderCompare();
  renderSearch();    /* the added player drops out of the results */
}

function renderSearch() {
  var input = el("psearch");
  var box = el("psearchresults");
  var note = el("psearchnote");
  if (!input || !box) return;

  var q = input.value;
  var matches = searchMatches(q);
  box.innerHTML = "";

  if (selectionFull()) {
    note.textContent = "8 selected — remove one to add another.";
    return;
  }
  note.textContent = "";

  if (!q.trim()) return;
  if (!matches.length) {
    box.innerHTML = '<p class="sub">No player matches &ldquo;' + q + "&rdquo;.</p>";
    return;
  }

  var t = ["<table><tbody>"];
  matches.slice(0, MAX_RESULTS).forEach(function (r) {
    t.push("<tr>" +
      '<td><a href="#" data-add="' + r.player_id + '">' + r.name + "</a></td>" +
      "<td>" + (r.position || "") + "</td>" +
      "<td>" + (r.team || "") + "</td>" +
      "<td>" + (r.opponent || "") + "</td>" +
      '<td class="num">' + num(r.total, 1) + "</td>" +
      "</tr>");
  });
  t.push("</tbody></table>");
  if (matches.length > MAX_RESULTS) {
    t.push('<p class="sub">' + (matches.length - MAX_RESULTS) + " more — keep typing.</p>");
  }
  box.innerHTML = t.join("");
}

function bindSearch() {
  var input = el("psearch");
  if (!input) return;
  input.addEventListener("input", renderSearch);
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var m = searchMatches(input.value);
    if (m.length && !selectionFull()) addFromSearch(m[0].player_id);
  });
  /* Results are rebuilt on every keystroke, so listen on the container. */
  el("psearchresults").addEventListener("click", function (e) {
    var pid = e.target && e.target.getAttribute && e.target.getAttribute("data-add");
    if (!pid) return;
    e.preventDefault();
    addFromSearch(pid);
  });
}
