// Q4 signalling-question decision tree — the ROB-ME judgement logic itself —
// shared between app.js (runs in the browser) and Node scripts that need the
// exact same logic (the exhaustive test in "4. html app test/decision tree
// test/" and the auto-generated flowchart diagram in
// "docs/flowchart-gen/generate.js"). Extracted 2026-08-07 after a diagram
// generated from a hand-copied second version of this logic drew Path A
// wrong (see docs/ROB-ME_design_decisions.md) — a single copy that every
// consumer requires/imports makes that class of drift structurally
// impossible instead of relying on manually keeping copies in sync.
// UMD-style export: `module.exports` under Node, `window.RobMeDecisionTree`
// in the browser (loaded via a plain <script> tag before app.js).
(function (root, factory) {
  const shared = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = shared;
  } else {
    root.RobMeDecisionTree = shared;
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Real dropdown domains (blank = "not yet answered", not a valid final
  // value) — Q4.1/Q4.3/Q4.5 are auto-filled Yes/No only, Q4.2/Q4.4 additionally
  // allow "No information", Q4.6/Q4.7/Q4.8 do not.
  const Q4_YN_CHOICES = ["", "Yes", "No"];
  const Q4_YPN_NI_CHOICES = ["", "Yes", "Probably yes", "Probably no", "No", "No information"];
  const Q4_YPN_CHOICES = ["", "Yes", "Probably yes", "Probably no", "No"];
  const YES_PROBABLY_YES = ["Yes", "Probably yes"];
  const NO_PROBABLY_NO = ["No", "Probably no"];
  const YES_PROB_NO_INFO = ["Yes", "Probably yes", "No information"];

  function isAnswerEmpty(v) {
    return v === undefined || v === null || v === "";
  }

  function anyAnswerEmpty(...vals) {
    return vals.some(isAnswerEmpty);
  }

  // Direct port of the R app's calculate_rob_suggestion() decision tree.
  // Keep in lockstep with that function if the tree ever changes there.
  // Same decision tree as before, but threaded with a `trail` of plain-English
  // facts ("Q4.5 = Yes") accumulated as each branch is evaluated, so the UI
  // can show *why* a suggestion was reached — from the same single source of
  // truth as the suggestion itself, not a second copy that could drift out
  // of sync with it.
  function calculateRobSuggestionDetailed(q4_1, q4_2, q4_3, q4_4, q4_5, q4_6, q4_7, q4_8) {
    const trail = [];
    const conclude = (result) => {
      trail.push(result ? `→ Suggested: ${result}` : "→ Not enough answers yet to suggest a judgement.");
      return { result, trail };
    };

    if (!anyAnswerEmpty(q4_1, q4_3) && q4_1 === "No" && q4_3 === "No") {
      trail.push("Q4.1 = No", "Q4.3 = No");
      if (isAnswerEmpty(q4_5)) return conclude("");
      trail.push(`Q4.5 = ${q4_5}`);
      if (q4_5 === "No") return conclude("Low");
      if (q4_5 === "Yes") {
        if (anyAnswerEmpty(q4_6, q4_7)) return conclude("");
        trail.push(`Q4.6 = ${q4_6}`, `Q4.7 = ${q4_7}`);
        if (NO_PROBABLY_NO.includes(q4_6)) {
          if (NO_PROBABLY_NO.includes(q4_7)) return conclude("Low");
          if (YES_PROBABLY_YES.includes(q4_7)) {
            if (isAnswerEmpty(q4_8)) return conclude("");
            trail.push(`Q4.8 = ${q4_8}`);
            if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
            if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
          }
        }
        if (YES_PROBABLY_YES.includes(q4_6)) {
          if (NO_PROBABLY_NO.includes(q4_7)) {
            if (isAnswerEmpty(q4_8)) return conclude("");
            trail.push(`Q4.8 = ${q4_8}`);
            if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
            if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
          }
          if (YES_PROBABLY_YES.includes(q4_7)) return conclude("High");
        }
      }
    } else if (!anyAnswerEmpty(q4_1, q4_3) && (q4_1 === "Yes" || q4_3 === "Yes")) {
      trail.push(`Q4.1 = ${q4_1}`, `Q4.3 = ${q4_3}`);
      if (q4_1 === "Yes" && isAnswerEmpty(q4_2)) return conclude("");
      if (q4_3 === "Yes" && isAnswerEmpty(q4_4)) return conclude("");
      if (!isAnswerEmpty(q4_2)) trail.push(`Q4.2 = ${q4_2}`);
      if (!isAnswerEmpty(q4_4)) trail.push(`Q4.4 = ${q4_4}`);

      // Q4.2 = Yes/Probably yes is the flowchart's immediate-High shortcut —
      // it must fire ahead of the Q4.4 branch below, not as a last resort.
      const isQ42HighConcernFirst = q4_1 === "Yes" && !isAnswerEmpty(q4_2) && YES_PROBABLY_YES.includes(q4_2);
      if (isQ42HighConcernFirst) return conclude("High");

      const condAQ42 = ["No", "Probably no", ""];
      const condAQ44 = ["No", "Probably no", ""];
      const isQ42Low = q4_1 === "No" || (!isAnswerEmpty(q4_2) && condAQ42.includes(q4_2));
      const isQ44Low = q4_3 === "No" || (!isAnswerEmpty(q4_4) && condAQ44.includes(q4_4));

      if (isQ42Low && isQ44Low) {
        if (isAnswerEmpty(q4_5)) return conclude("");
        trail.push(`Q4.5 = ${q4_5}`);
        if (q4_5 === "No") {
          if (isAnswerEmpty(q4_7)) return conclude("");
          trail.push(`Q4.7 = ${q4_7}`);
          if (NO_PROBABLY_NO.includes(q4_7)) return conclude("Low");
          if (YES_PROBABLY_YES.includes(q4_7)) {
            if (isAnswerEmpty(q4_8)) return conclude("");
            trail.push(`Q4.8 = ${q4_8}`);
            if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
            if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
          }
        }
        if (q4_5 === "Yes") {
          if (anyAnswerEmpty(q4_6, q4_7)) return conclude("");
          trail.push(`Q4.6 = ${q4_6}`, `Q4.7 = ${q4_7}`);
          if (NO_PROBABLY_NO.includes(q4_6)) {
            if (NO_PROBABLY_NO.includes(q4_7)) return conclude("Low");
            if (YES_PROBABLY_YES.includes(q4_7)) {
              if (isAnswerEmpty(q4_8)) return conclude("");
              trail.push(`Q4.8 = ${q4_8}`);
              if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
              if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
            }
          }
          if (YES_PROBABLY_YES.includes(q4_6)) {
            if (NO_PROBABLY_NO.includes(q4_7)) {
              if (isAnswerEmpty(q4_8)) return conclude("");
              trail.push(`Q4.8 = ${q4_8}`);
              if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
              if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
            }
            if (YES_PROBABLY_YES.includes(q4_7)) return conclude("High");
          }
        }
        return conclude("");
      }

      const condBQ44 = ["Yes", "Probably yes", "No information"];
      const isQ42InfoMissing = q4_1 === "Yes" && !isAnswerEmpty(q4_2) && q4_2 === "No information";
      const isQ44HighConcern = q4_3 === "Yes" && !isAnswerEmpty(q4_4) && condBQ44.includes(q4_4);

      if (isQ42InfoMissing || isQ44HighConcern) {
        if (isAnswerEmpty(q4_5)) return conclude("");
        trail.push(`Q4.5 = ${q4_5}`);
        if (q4_5 === "Yes") {
          if (isAnswerEmpty(q4_6)) return conclude("");
          trail.push(`Q4.6 = ${q4_6}`);
        }
        // Q4.5/Q4.6 are still asked here (and gate when a suggestion can be
        // shown), but per the flowchart neither one changes the outcome in
        // this branch — Q4.7/Q4.8 alone decide between Some concerns and
        // High. Confirmed against the printed flowchart 2026-08-07; the R
        // reference script's q46-gated formula does NOT match this branch
        // (see 4. html app test/decision tree test/README.md).
        if (isAnswerEmpty(q4_7)) return conclude("");
        trail.push(`Q4.7 = ${q4_7}`);
        if (YES_PROBABLY_YES.includes(q4_7)) return conclude("High");
        if (NO_PROBABLY_NO.includes(q4_7)) {
          if (isAnswerEmpty(q4_8)) return conclude("");
          trail.push(`Q4.8 = ${q4_8}`);
          if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
          if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
        }
        return conclude("");
      }
    }

    return conclude("");
  }

  function calculateRobSuggestion(q4_1, q4_2, q4_3, q4_4, q4_5, q4_6, q4_7, q4_8) {
    return calculateRobSuggestionDetailed(q4_1, q4_2, q4_3, q4_4, q4_5, q4_6, q4_7, q4_8).result;
  }

  // Pure version of the R app's Step 4 `observe` block: given which Step 2/3
  // markers were found and the current raw Q4.2/4.4/4.6/4.7/4.8 values, works
  // out Q4.1/4.3/4.5's auto-filled values, which of Q4.2/4.4/4.6/4.7/4.8 are
  // enabled (clearing any that aren't), and the resulting suggested judgement
  // + reasoning trail. Takes no state and mutates nothing, so it can be
  // called identically from app.js (against live `state.answers`), the
  // exhaustive test script, and the flowchart generator (swept over every
  // valid combination of foundX/foundQMark/isQ3Checked).
  function computeStep4Cascade({ foundX, foundQMark, isQ3Checked, q4_2, q4_4, q4_6, q4_7, q4_8 }) {
    const q4_1 = foundX ? "Yes" : "No";
    const q4_2Enabled = foundX;
    const q4_2Value = q4_2Enabled ? (q4_2 || "") : "";

    const q4_3 = foundQMark ? "Yes" : "No";
    const q4_4Enabled = foundQMark;
    const q4_4Value = q4_4Enabled ? (q4_4 || "") : "";

    const q4_5 = isQ3Checked ? "Yes" : "No";
    const q4_6Enabled = isQ3Checked;
    const q4_6Value = q4_6Enabled ? (q4_6 || "") : "";

    const q4_7Enabled = foundX || foundQMark || isQ3Checked;
    const q4_7Value = q4_7Enabled ? (q4_7 || "") : "";

    const q4_8Enabled = YES_PROB_NO_INFO.includes(q4_2Value) || YES_PROB_NO_INFO.includes(q4_4Value) ||
      YES_PROBABLY_YES.includes(q4_6Value) || YES_PROBABLY_YES.includes(q4_7Value);
    const q4_8Value = q4_8Enabled ? (q4_8 || "") : "";

    const suggestion = calculateRobSuggestionDetailed(
      q4_1, q4_2Value, q4_3, q4_4Value, q4_5, q4_6Value, q4_7Value, q4_8Value
    );

    return {
      q4_1, q4_3, q4_5,
      q4_2: q4_2Value, q4_4: q4_4Value, q4_6: q4_6Value, q4_7: q4_7Value, q4_8: q4_8Value,
      q4_2Enabled, q4_4Enabled, q4_6Enabled, q4_7Enabled, q4_8Enabled,
      suggestion,
    };
  }

  return {
    Q4_YN_CHOICES,
    Q4_YPN_NI_CHOICES,
    Q4_YPN_CHOICES,
    YES_PROBABLY_YES,
    NO_PROBABLY_NO,
    YES_PROB_NO_INFO,
    isAnswerEmpty,
    anyAnswerEmpty,
    calculateRobSuggestionDetailed,
    calculateRobSuggestion,
    computeStep4Cascade,
  };
});
