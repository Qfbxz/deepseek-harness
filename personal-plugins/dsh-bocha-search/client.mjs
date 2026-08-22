/**
 * dsh-bocha-search — browser half (no-op).
 *
 * 2026-08-22: the composer search-count cell this module used to inject
 * (`#dsh-bocha-cell`) is fully superseded by dsh-usage-all's bocha cell
 * (`#dsh-usage-all-bocha-cell`, anchored at the model rings row). The search
 * provider itself lives in the server half (index.mjs); this stub only keeps
 * the module-loader contract so the bundle keeps loading cleanly.
 */
window.__ModuleLoader__.load({
  id: "dsh-bocha-search",
  factory: function () {
    var module = { exports: {} };
    module.exports.apply = function () { /* no-op: count cell moved to dsh-usage-all */ };
    return module.exports;
  },
});
