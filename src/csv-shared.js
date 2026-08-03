// Field list + CSV encoding shared between app.js (runs in the browser) and
// build.js (runs in Node, to generate dist/ROB-ME_template_progress.csv) so
// the two can never drift apart the way a hand-maintained template file did.
// UMD-style export: `module.exports` under Node, `window.RobMeShared` in the
// browser (loaded via a plain <script> tag before app.js).
(function (root, factory) {
  const shared = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = shared;
  } else {
    root.RobMeShared = shared;
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const STEP1_FIELD_SUFFIXES = ["_p", "_i", "_c", "_o", "_ds", "_oc", "_met"];
  const STEP4_MA_FIELD_SUFFIXES = [
    "_title", "_result", "_ma_n_study", "_ma_ss",
    "_q4_1", "_q4_2", "_q4_3", "_q4_4", "_q4_5", "_q4_6", "_q4_7", "_q4_8",
    "_rob_suggested", "_rob_final", "_rob_dir", "_rob_rm",
    "_forest_plot_data", "_funnel_plot_data",
  ];

  // A cell whose text starts with =, +, -, or @ gets executed as a live
  // formula by Excel/Sheets/LibreOffice on CSV import ("CSV injection" —
  // e.g. a PICO field of `=HYPERLINK("http://evil","click")`). Prefixing
  // with a single quote is the standard mitigation: spreadsheet apps treat
  // a leading apostrophe as "force text" and hide it on display. This app's
  // own importProgressCsv strips that same prefix back off on re-import
  // (see the FORMULA_GUARD_RE check there), so round-tripping a save file
  // through this app itself stays lossless — the guard only matters to
  // someone opening the raw CSV directly in a spreadsheet app.
  const FORMULA_GUARD_RE = /^[=+\-@]/;

  function csvEscapeCell(value) {
    let str = value === undefined || value === null ? "" : String(value);
    if (FORMULA_GUARD_RE.test(str)) str = `'${str}`;
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  function encodeCsv(rows) {
    return rows.map((row) => row.map(csvEscapeCell).join(",")).join("\r\n");
  }

  // The complete set of field keys ("varnames") a given n_ma/n_studies combo
  // should have — mirrors the R app's get_all_varnames(), used both to write
  // every field on export and to flag unrecognized fields on import.
  function getAllVarnames(n_ma, n_studies) {
    const vars = [
      "n_ma", "n_studies", "output_title",
      "q3_1_results", "q3_2_results", "q3_3_results", "q3_overall", "q3_rm",
    ];
    for (let i = 1; i <= n_ma; i++) {
      STEP1_FIELD_SUFFIXES.forEach((s) => vars.push(`${i}${s}`));
      vars.push(`${i}_step2_ma_rm`);
    }
    for (let y = 1; y <= n_studies; y++) {
      vars.push(`${y}_id`, `${y}_source`, `${y}_ss`);
    }
    for (let x = 1; x <= n_ma; x++) {
      for (let y = 1; y <= n_studies; y++) {
        vars.push(`${x}_${y}_results`);
      }
    }
    for (let i = 1; i <= n_ma; i++) {
      STEP4_MA_FIELD_SUFFIXES.forEach((s) => vars.push(`${i}${s}`));
    }
    return vars;
  }

  return {
    STEP1_FIELD_SUFFIXES,
    STEP4_MA_FIELD_SUFFIXES,
    csvEscapeCell,
    encodeCsv,
    getAllVarnames,
    FORMULA_GUARD_RE,
  };
});
