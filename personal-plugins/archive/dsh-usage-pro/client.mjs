/**
 * dsh-usage-pro — browser half (minimal v1).
 * Reads the plugin's own summary route; UI surface comes next.
 */
/* global window */
window.__ModuleLoader__.load({
  id: "dsh-usage-pro",
  factory: function () {
    "use strict";
    function apply() {
      // v1: data capture only; the panel/widget wiring lands in v2
    }
    var module = { exports: {} };
    module.exports.apply = apply;
    return module.exports;
  },
});
