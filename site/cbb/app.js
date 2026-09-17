/* CBB gameday. Reads a published season archive; in season this same shape is
   refreshed nightly. Until the publish path exists (see plan step 8) the page
   states that plainly rather than showing an empty table.

   Per-team scores are derived, not stored upstream:
     score_A = (pred_total + pred_margin) / 2
     score_B = (pred_total - pred_margin) / 2  */

var DATA_URL = null; /* set once the cbb publish prefix is live (plan step 8) */

var PENDING_NOTE =
  "The gameday feed isn't published yet. College basketball is out of season " +
  "until November — this page will show a browsable 2026 season archive " +
  "(11,126 games, 5,642 with a KenPom comparison) once the publish step lands, " +
  "then switch to nightly slates when the season starts.";

function boot() {
  if (!DATA_URL) {
    hide("loading");
    el("note").textContent = PENDING_NOTE;
    var e = el("error");
    e.hidden = false;
    e.classList.remove("err");
    e.innerHTML = '<span class="muted">Not published yet — see below.</span>';
    return;
  }
  fetchJSON(DATA_URL).then(render).catch(function (err) { showError(err, DATA_URL); });
}

function render(data) {
  hide("loading");
  show("content");
  renderUpdated("updated", data.meta && data.meta.generated);
  /* wired in step 8 */
}

boot();
