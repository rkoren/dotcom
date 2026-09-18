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
        ? "Tick up to " + MAX_COMPARE + " players above."
        : "Tick at least one more player to compare.";
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
  });
}
