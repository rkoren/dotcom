/* Head-to-head compare, computed client-side.

   The API's pairwise win matrix is built from per-player Monte Carlo samples drawn
   with independent seeds, and the UI documents it as "independent between players".
   Under that same assumption P(A beats B) is recoverable from the published
   per-player histograms over a shared bin grid:

     P(A > B) = sum_i histA[i] * (sum_{j<i} histB[j])  +  0.5 * sum_i histA[i] * histB[i]

   That means any subset of players is comparable from one published file, rather
   than needing a server round-trip per combination.

   Known approximation: the server compares raw float samples, this compares 1-point
   bins, so ties inside a bin take 0.5 weight. Expect agreement within ~1-2 points.
   Halve the bin width upstream if exact parity is ever needed. */

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

/* Rendering wired in step 7, alongside the weekly table. */
