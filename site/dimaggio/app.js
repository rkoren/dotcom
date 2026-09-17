/* DiMaggio Watch. Reads the live payload published by the dimaggio-watch Lambda.
   No bundled fallback: the committed copy in that repo is schema-stale (missing
   liveStatus/provisional/inJeopardy), so a stale-data bug would be invisible.
   An honest error state is better. */

var DATA_URL =
  "https://dimaggio-watch-data-674325521451.s3.us-east-1.amazonaws.com/streaks.json";

/* Poll faster while any streak is live, as the upstream UI does. */
var POLL_LIVE_MS = 15000;
var POLL_IDLE_MS = 60000;

var lastGeneratedAt = null;
var timer = null;
var currentRows = [];
var sortState = null;   /* bound once; see makeSortable in lib.js */

function stateCell(r) {
  if (r.liveStatus === "hitToday") return '<span class="live">hit today</span>';
  if (r.liveStatus === "inJeopardy") return '<span class="jeopardy">in jeopardy</span>';
  if (r.provisional) return '<span class="muted">provisional</span>';
  if (r.inJeopardy) return '<span class="jeopardy">in jeopardy</span>';
  return "";
}

function drawRows(rows) {
  var tbody = el("rows");
  tbody.innerHTML = "";
  rows.forEach(function (r) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="num">' + r.rank + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + (r.team || "") + "</td>" +
      '<td class="num"><strong>' + r.streak + "</strong></td>" +
      "<td>" + fmtDay(r.startDate) + "</td>" +
      "<td>" + fmtDay(r.lastHitDate) + "</td>" +
      '<td class="num">' + (r.gamesToRecord === null ? "" : r.gamesToRecord) + "</td>" +
      "<td>" + stateCell(r) + "</td>";
    tbody.appendChild(tr);
  });
}

function render(data) {
  currentRows = data.streaks || [];

  if (!currentRows.length) {
    el("lead").innerHTML =
      '<span class="muted">No active hitting streaks right now — check back during the season.</span>';
    el("board").hidden = true;
  } else {
    el("board").hidden = false;
    var top = currentRows[0];
    el("lead").innerHTML =
      "Leader: <strong>" + top.name + "</strong> (" + (top.teamName || top.team) +
      ") at <strong>" + top.streak + "</strong> games — " +
      top.gamesToRecord + " short of the record.";

    /* Bind once, then keep whatever sort the reader picked across refreshes. */
    if (!sortState) {
      sortState = makeSortable(
        el("board"),
        function () { return currentRows; },
        function () { drawRows(currentRows); }
      );
    }
    if (sortState.key) sortRows(currentRows, sortState.key, sortState.dir);
    drawRows(currentRows);
  }

  var rec = data.record;
  if (rec) {
    el("record").textContent =
      "The record: " + rec.holder + ", " + rec.length + " games, " +
      rec.year + " (" + rec.team + ").";
  }

  renderUpdated("updated", data.generatedAt);
  hide("loading");
  hide("error");
  show("content");
}

function nextDelay(data) {
  var live = (data.streaks || []).some(function (r) { return r.liveStatus; });
  return live ? POLL_LIVE_MS : POLL_IDLE_MS;
}

function refresh() {
  return fetchJSON(DATA_URL)
    .then(function (data) {
      /* Only re-render when the payload actually changed — avoids stomping an
         in-progress column sort every poll. */
      if (data.generatedAt !== lastGeneratedAt) {
        lastGeneratedAt = data.generatedAt;
        render(data);
      } else {
        renderUpdated("updated", data.generatedAt);
      }
      schedule(nextDelay(data));
    })
    .catch(function (err) {
      showError(err, DATA_URL);
      schedule(POLL_IDLE_MS);
    });
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(refresh, ms);
}

/* Don't poll a hidden tab; refetch immediately when it comes back. */
document.addEventListener("visibilitychange", function () {
  if (document.hidden) clearTimeout(timer);
  else refresh();
});

/* Keep the "updated Xm ago" line honest between polls. */
setInterval(function () { renderUpdated("updated", lastGeneratedAt); }, 30000);

refresh();
