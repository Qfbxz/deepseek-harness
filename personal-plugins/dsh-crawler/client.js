/* ⚠️ REWRITE RULE: this file MUST use the __ModuleLoader__ script contract:
 * window.__ModuleLoader__.load({ id, factory }) with the factory returning
 * { apply }. Plain ESM exports are IGNORED by the client loader and break
 * the whole UI ("loaded without registering"). */
/* dsh-crawler browser half: NONE by design — all settings live in the GUI
 * 设置 page (official settings seam, namespace "pawl"). This stub only
 * satisfies the dsh.client declaration so the loader has something to mount. */
window.__ModuleLoader__.load({
  id: "dsh-crawler",
  factory: function () {
    var module = { exports: {} };
    var exports = module.exports;
    exports.apply = function apply() {};
    return module.exports;
  },
});
