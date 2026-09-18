/* Head-to-head compare

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


/* ---------------------------------------------------------------- distribution chart

   The published histograms are already the shape of a density curve, so plotting them
   needs no library and no extra data — one polyline per player over the shared bin grid.
   Inline SVG keeps it in the no-build spirit; ~40 lines against ~500KB of recharts.

   The x-range is trimmed to where the selected players actually have mass, otherwise a
   fixed 0..80 grid squeezes every curve into the left third and they all look identical. */

var CHART_W = 620, CHART_H = 150, PAD_L = 30, PAD_B = 22, PAD_T = 8;

function chartRange(hists) {
  /* First and last bin holding non-trivial mass for anyone, padded a little. */
  var lo = Infinity, hi = 0;
  hists.forEach(function (h) {
    for (var i = 0; i < h.length; i++) {
      if (h[i] > 0.001) { if (i < lo) lo = i; if (i > hi) hi = i; }
    }
  });
  if (lo === Infinity) return [0, 1];
  return [Math.max(0, lo - 1), hi + 1];
}

function distributionChart(picks, byId) {
  var hists = picks.map(function (p) { return dists.hist[p]; });
  var r = chartRange(hists), lo = r[0], hi = r[1];
  var bw = (dists && dists.binWidth) || 1;
  var peak = 0;
  hists.forEach(function (h) {
    for (var i = lo; i <= hi; i++) if ((h[i] || 0) > peak) peak = h[i];
  });
  if (!peak) return "";

  var plotW = CHART_W - PAD_L - 6, plotH = CHART_H - PAD_B - PAD_T;
  var x = function (i) { return PAD_L + ((i - lo) / (hi - lo || 1)) * plotW; };
  var y = function (v) { return PAD_T + plotH - (v / peak) * plotH; };

  var out = ['<svg class="dist" width="' + CHART_W + '" height="' + CHART_H +
             '" role="img" aria-label="Projected point distributions">'];
  out.push('<line class="axis" x1="' + PAD_L + '" y1="' + (PAD_T + plotH) +
           '" x2="' + (PAD_L + plotW) + '" y2="' + (PAD_T + plotH) + '"/>');

  /* x ticks every 5 points, which is a readable granularity for fantasy scoring. */
  for (var b = Math.ceil(lo / 5) * 5; b <= hi; b += 5) {
    out.push('<line class="tick" x1="' + x(b) + '" y1="' + (PAD_T + plotH) +
             '" x2="' + x(b) + '" y2="' + (PAD_T + plotH + 3) + '"/>');
    out.push('<text class="tlab" x="' + x(b) + '" y="' + (CHART_H - 8) +
             '" text-anchor="middle">' + Math.round(b * bw) + "</text>");
  }

  hists.forEach(function (h, n) {
    var pts = [];
    for (var i = lo; i <= hi; i++) pts.push(x(i).toFixed(1) + "," + y(h[i] || 0).toFixed(1));
    out.push('<polyline class="c' + (n % 8) + '" points="' + pts.join(" ") + '"/>');
  });
  out.push("</svg>");

  out.push('<p class="legend">');
  picks.forEach(function (p, n) {
    out.push('<span class="c' + (n % 8) + '">&#9632;</span> ' + ((byId[p] || {}).name || p) + " ");
  });
  out.push("</p>");
  out.push('<p class="sub">Share of simulated outcomes at each point total</p>');
  return out.join("");
}


/* Cell formatters, kept separate from the raw values so the "who leads" comparison can be
   made on what is actually DISPLAYED. Comparing raw floats would occasionally bold one of
   two cells that both read "12.3", which looks like a bug. */
function pts1(v) { return v === null || v === undefined ? "" : num(v, 1); }
function pct0(v) { return v === null || v === undefined ? "" : Math.round(v * 100) + "%"; }

/* Indices of the highest displayed value; every metric in the table is higher-is-better. */
function leaders(shown) {
  var best = null, out = [];
  shown.forEach(function (cell, i) {
    var v = parseFloat(cell);
    if (isNaN(v)) return;
    if (best === null || v > best) { best = v; out = [i]; }
    else if (v === best) out.push(i);
  });
  return out;
}

function renderCompare() {
  var box = el("compare");
  var hint = el("cmphint");
  box.innerHTML = "";

  if (!selected.length) {
    hint.textContent =
      "Search for a player, or tick one in the table below (up to " + MAX_COMPARE + ").";
    return;
  }
  /* One player is enough to render: seeing a single column makes it obvious what a
     second one will add, rather than leaving an empty panel until you guess. */
  hint.innerHTML =
    selected.length + " selected (max " + MAX_COMPARE + "). " +
    (selected.length === 1 ? "Add another to compare head-to-head. " : "") +
    '<a href="#" id="clearcmp">clear</a>';

  var byId = rowsById();
  var bw = (dists && dists.binWidth) || 1;
  var picks = selected.filter(function (p) { return dists && dists.hist[p]; });
  var missing = selected.filter(function (p) { return !(dists && dists.hist[p]); });

  if (!picks.length) {
    box.innerHTML = '<p class="sub">No distribution published for the selected player(s).</p>';
    return;
  }

  /* Transposed: players as columns, metrics as rows. Every metric here is
     higher-is-better, so the leader per row is simply the max. */
  var metrics = [
    ["Projected",     function (r, h) { return r.total; },              pts1],
    ["Floor (p20)",   function (r, h) { return pctile(h, 0.2, bw); },   pts1],
    ["Median (p50)",  function (r, h) { return pctile(h, 0.5, bw); },   pts1],
    ["Ceiling (p80)", function (r, h) { return pctile(h, 0.8, bw); },   pts1],
    ["P(15+ pts)",    function (r, h) { return atLeast(h, 15, bw); },   pct0],
    ["P(20+ pts)",    function (r, h) { return atLeast(h, 20, bw); },   pct0],
    ["P(25+ pts)",    function (r, h) { return atLeast(h, 25, bw); },   pct0]
  ];

  var t = ["<table><thead><tr><th class='nosort'>&nbsp;</th>"];
  picks.forEach(function (p) {
    var r = byId[p] || { name: p };
    t.push("<th class='nosort'>" + r.name +
      "<br><span class='muted'>" + (r.position || "") + " " + (r.team || "") + "</span></th>");
  });
  t.push("</tr></thead><tbody>");
  metrics.forEach(function (m) {
    var shown = picks.map(function (p) { return m[2](m[1](byId[p] || {}, dists.hist[p])); });
    var lead = leaders(shown);
    t.push("<tr><td>" + m[0] + "</td>");
    shown.forEach(function (cell, i) {
      /* Bold every cell tied at the top — claiming a single winner when two are level
         would be a lie the reader can see. With one player there is nothing to lead. */
      var win = picks.length > 1 && lead.indexOf(i) >= 0;
      t.push("<td class='num" + (win ? " best" : "") + "'>" +
        (win ? "<strong>" + cell + "</strong>" : cell) + "</td>");
    });
    t.push("</tr>");
  });
  t.push("</tbody></table>");

  t.push("<h2>Projected point distribution</h2>");
  t.push(distributionChart(picks, byId));

  /* Head to head. With exactly two players a matrix states one fact twice and pads it
     with two dashes ("52%" and "48%" are the same number), so say it in a sentence
     instead. The grid only earns its space once there are pairs worth scanning. */
  if (picks.length === 2) {
    var pa = byId[picks[0]] || { name: picks[0] };
    var pb = byId[picks[1]] || { name: picks[1] };
    var pw = beats(dists.hist[picks[0]], dists.hist[picks[1]]);
    var lead = pw >= 0.5 ? [pa, pb, pw] : [pb, pa, 1 - pw];
    t.push("<h2>Head to head</h2>");
    t.push('<p class="h2h"><strong>' + lead[0].name + "</strong> outscores " +
      lead[1].name + " in <strong>" + Math.round(lead[2] * 100) +
      "%</strong> of simulations.</p>");
    if (Math.round(lead[2] * 100) === 50) {
      t.push('<p class="sub">Effectively a coin flip.</p>');
    }
  } else if (picks.length > 2) {
    t.push("<h2>Head to head</h2>");
    t.push('<p class="sub">Each cell is the chance the player on the left outscores the ' +
      "player along the top. Bold means better than even.</p>");
    t.push("<table><thead><tr><th class='nosort'>beats &rarr;</th>");
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
  }

  if (picks.length > 1) {
    t.push('<p class="sub">From ' + (dists.draws || "?") +
      " Monte Carlo draws per player, independent between players, binned to " +
      bw + " point" + (bw === 1 ? "" : "s") + ".</p>");
  }

  if (missing.length) {
    t.push('<p class="sub">No distribution published for ' + missing.length +
      " selected player(s).</p>");
  }
  box.innerHTML = t.join("");

  var clear = el("clearcmp");
  if (clear) clear.addEventListener("click", function (e) {
    e.preventDefault();
    selected = [];
    refreshSelection();
  });
}


/* ---------------------------------------------------------------- player search

   Every player for the active profile is already in memory, so this filters locally
   rather than calling an API.
 */

var MAX_RESULTS = 8;

/* Ranking: score = matchTier + QUALITY_WEIGHT * (points / bestPoints) */
var TIER = {
  EXACT: 1.0,
  LAST_PREFIX: 0.9,
  OTHER_PREFIX: 0.8,
  FIRST_PREFIX: 0.7,
  FIELD_EXACT: 0.95,
  LAST_SUB: 0.5,
  FIRST_SUB: 0.4,
  ANY: 0.25
};
var QUALITY_WEIGHT = 0.35;
var SUFFIXES = { jr: 1, "jr.": 1, sr: 1, "sr.": 1, ii: 1, iii: 1, iv: 1, v: 1 };
var searchIndex = null;
var bestPoints = 0;

function buildSearchIndex(rows) {
  bestPoints = 0;
  searchIndex = rows.map(function (r) {
    var name = (r.name || "").toLowerCase();
    var tokens = name.split(/\s+/).filter(Boolean);
    var meaningful = tokens.filter(function (t) { return !SUFFIXES[t]; });
    if (!meaningful.length) meaningful = tokens;
    if ((r.total || 0) > bestPoints) bestPoints = r.total || 0;
    return {
      row: r,
      full: name,
      first: meaningful[0] || "",
      last: meaningful[meaningful.length - 1] || "",
      mid: meaningful.slice(1, -1),
      team: (r.team || "").toLowerCase(),
      pos: (r.position || "").toLowerCase()
    };
  });
}

/* Best tier this one term achieves against one player; 0 means no match at all. */
function termTier(ix, t) {
  if (ix.full === t) return TIER.EXACT;
  if (ix.team === t || ix.pos === t) return TIER.FIELD_EXACT;
  if (ix.last.indexOf(t) === 0) return TIER.LAST_PREFIX;
  for (var i = 0; i < ix.mid.length; i++) {
    if (ix.mid[i].indexOf(t) === 0) return TIER.OTHER_PREFIX;
  }
  if (ix.first.indexOf(t) === 0) return TIER.FIRST_PREFIX;
  if (ix.last.indexOf(t) > 0) return TIER.LAST_SUB;
  if (ix.first.indexOf(t) > 0) return TIER.FIRST_SUB;
  if (ix.full.indexOf(t) >= 0) return TIER.ANY;
  return 0;
}

function searchMatches(q) {
  q = q.trim().toLowerCase();
  if (!q || !searchIndex) return [];
  var terms = q.split(/\s+/).filter(Boolean);
  var out = [];

  for (var i = 0; i < searchIndex.length; i++) {
    var ix = searchIndex[i];
    /* Every term must hit something — "justin jeff" should not match Justin Fields. */
    var sum = 0, ok = true;
    for (var j = 0; j < terms.length; j++) {
      var tier = termTier(ix, terms[j]);
      if (!tier) { ok = false; break; }
      sum += tier;
    }
    if (!ok) continue;
    var quality = bestPoints > 0 ? (ix.row.total || 0) / bestPoints : 0;
    out.push({ row: ix.row, score: sum / terms.length + QUALITY_WEIGHT * quality });
  }

  out.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return (b.row.total || 0) - (a.row.total || 0);   /* stable, explainable tiebreak */
  });
  return out.map(function (m) { return m.row; });
}

/* The selection shows up in four places (table, picked row, search results, compare
   panel). Refresh them together rather than at each call site, or one drifts. */
function refreshSelection() {
  drawRows();
  renderPicked();
  renderSearch();
  renderCompare();
}

/* Search rows toggle, they do not only add: the box shows current state, so unticking
   removes. Returns false when a pick was refused (the cap). */
function toggleFromSearch(pid, on) {
  var ok = toggleSelected(pid, on);
  refreshSelection();
  return ok;
}

/* The picked row exists so a player can be removed without searching for him again --
   the compare table names him, but nothing there is a control. */
function renderPicked() {
  var box = el("picked");
  if (!box) return;
  if (!selected.length) { box.innerHTML = ""; return; }
  var byId = rowsById();
  var t = ['<div class="controls"><span class="muted">Selected:</span> '];
  selected.forEach(function (pid) {
    var r = byId[pid] || { name: pid };
    t.push('<label><input type="checkbox" checked data-pick="' + pid + '"> ' +
      r.name + '<span class="muted">' +
      (r.position ? " " + r.position : "") + (r.team ? " " + r.team : "") + "</span></label> ");
  });
  t.push("</div>");
  box.innerHTML = t.join("");
}

function renderSearch() {
  var input = el("psearch");
  var box = el("psearchresults");
  var note = el("psearchnote");
  if (!input || !box) return;

  var q = input.value;
  var matches = searchMatches(q);
  box.innerHTML = "";

  note.textContent = selectionFull()
    ? MAX_COMPARE + " selected — untick one to add another."
    : "";

  if (!q.trim()) return;
  if (!matches.length) {
    box.innerHTML = '<p class="sub">No player matches &ldquo;' + q + "&rdquo;.</p>";
    return;
  }

  var t = ["<table><tbody>"];
  matches.slice(0, MAX_RESULTS).forEach(function (r) {
    var on = isSelected(r.player_id);
    /* Same control as the table below, so "how do I pick someone" has one answer. */
    t.push("<tr>" +
      '<td><label><input type="checkbox" data-add="' + r.player_id + '"' +
        (on ? " checked" : "") + (!on && selectionFull() ? " disabled" : "") +
        "> " + r.name + "</label></td>" +
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
  /* Unticking in the picked row removes; rebuilt on every change, so listen on the box. */
  var picked = el("picked");
  if (picked) {
    picked.addEventListener("change", function (e) {
      var pid = e.target && e.target.getAttribute && e.target.getAttribute("data-pick");
      if (!pid) return;
      toggleSelected(pid, e.target.checked);
      refreshSelection();
    });
  }

  var input = el("psearch");
  if (!input) return;
  input.addEventListener("input", renderSearch);
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var m = searchMatches(input.value).filter(function (r) { return !isSelected(r.player_id); });
    if (m.length && !selectionFull()) toggleFromSearch(m[0].player_id, true);
  });
  /* Results are rebuilt on every keystroke, so listen on the container. */
  el("psearchresults").addEventListener("change", function (e) {
    var pid = e.target && e.target.getAttribute && e.target.getAttribute("data-add");
    if (!pid) return;
    if (!toggleFromSearch(pid, e.target.checked)) e.target.checked = false;
  });
}
