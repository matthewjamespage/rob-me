(function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const AUTOSAVE_KEY = "robme_autosave_v1";
  // Same placeholder build.js already substitutes into index.html's
  // #app-version span (see build.js's ROBME_VERSION replace step, which
  // runs on the *whole* built file, after app.js has been inlined into it —
  // so this occurrence gets caught by that same replace, no separate wiring
  // needed). Stays the literal string when running unbuilt from src/.
  const APP_VERSION = "__ROBME_VERSION__";
  // Upper bounds purely to reject/flag corrupted or hand-edited files before
  // they try to make the browser render an absurd number of pages/rows —
  // not real usage limits (a genuine review is very unlikely to hit these).
  const MAX_N_MA = 200;
  const MAX_N_STUDIES = 1000;
  const MAX_PLOT_FILE_BYTES = 10 * 1024 * 1024; // 10MB — soft warning, not enforced
  // Field list + CSV encoding live in csv-shared.js (loaded before this
  // script) so build.js can reuse the exact same logic to generate
  // dist/ROB-ME_template_progress.csv without risking drift.
  const {
    STEP1_FIELD_SUFFIXES,
    STEP4_MA_FIELD_SUFFIXES,
    csvEscapeCell,
    encodeCsv,
    getAllVarnames,
    FORMULA_GUARD_RE,
  } = window.RobMeShared;

  const state = {
    answers: { n_ma: 1 },
    currentPageIndex: 0,
  };

  let pages = [];
  // Populated by renderStepper() below, keyed by page.id, so the "answered"
  // dot on the *current* page's pill can be refreshed after a keystroke
  // without wiping/rebuilding the whole stepper bar or re-checking every
  // other page (see updateCurrentStepperPill()).
  let stepperPillsById = {};
  let autosaveTimer = null;
  // Remembers the Q3.1/Q3.2/Q3.3 combo (and which state.answers object it
  // was computed against) that q3_overall's suggestion was last derived
  // from — see applyStep3Cascade() below.
  let step3CascadeMemo = null;
  let autosaveStatusTimer = null;
  // Tracks whether the user's already been warned this session that local
  // autosave is failing (e.g. a large uploaded plot image pushed the
  // localStorage payload over the browser's quota) — avoids re-alerting on
  // every single keystroke's failed autosave attempt while the condition
  // persists. Reset the moment a save succeeds again.
  let autosaveQuotaWarningShown = false;

  // Page count/order depends on n_ma (2*n_ma+4 pages), so this must be
  // recomputed whenever n_ma changes, not just once at load.
  function buildPages() {
    const n_ma = Number(state.answers.n_ma) || 1;
    const list = [];
    list.push({ id: "landing", label: "Welcome", type: "landing" });
    list.push({ id: "instructions", label: "Instructions", type: "instructions" });
    list.push({ id: "about", label: "About", type: "about" });
    list.push({ id: "setup", label: "Initial Setup", type: "setup" });
    for (let i = 1; i <= n_ma; i++) {
      list.push({ id: `step1_${i}`, label: `Step 1 - MA ${i}`, type: "step1", maIndex: i });
    }
    list.push({ id: "step2", label: "Step 2", type: "step2" });
    list.push({ id: "step3", label: "Step 3", type: "step3" });
    for (let i = 1; i <= n_ma; i++) {
      list.push({ id: `step4_${i}`, label: `Step 4 - MA ${i}`, type: "step4", maIndex: i });
    }
    list.push({ id: "summary", label: "Summary", type: "summary" });
    pages = list;
  }

  function currentPage() {
    return pages[state.currentPageIndex];
  }

  function goToIndex(index) {
    if (index < 0 || index >= pages.length) return;
    state.currentPageIndex = index;
    render();
  }

  function goToId(id) {
    const index = pages.findIndex((p) => p.id === id);
    if (index !== -1) goToIndex(index);
  }

  const renderers = {
    landing: renderLanding,
    instructions: renderInstructions,
    about: renderAbout,
    setup: renderSetup,
    step1: renderStep1,
    step2: renderStep2,
    step3: renderStep3,
    step4: renderStep4,
    summary: renderSummary,
  };

  function renderLanding() {
    const div = document.createElement("div");
    div.className = "landing-page";
    div.innerHTML = `
      <h1 class="landing-title">Risk Of Bias due to Missing Evidence<br>(ROB-ME)</h1>
      <p class="landing-tagline">A tool for assessing risk of bias due to missing evidence in systematic reviews with meta-analysis.</p>

      <div class="landing-options">
        <button type="button" class="landing-button" data-action="goto-instructions">View Instructions</button>
        <button type="button" class="landing-button landing-button-primary" data-action="goto-setup">Start Assessment</button>
        <button type="button" class="landing-button" data-action="goto-about">About ROB-ME</button>
      </div>
    `;
    div.querySelector('[data-action="goto-instructions"]').addEventListener("click", () => goToId("instructions"));
    div.querySelector('[data-action="goto-setup"]').addEventListener("click", () => goToId("setup"));
    div.querySelector('[data-action="goto-about"]').addEventListener("click", () => goToId("about"));
    return div;
  }

  function renderInstructions() {
    const div = document.createElement("div");
    div.className = "instructions-page";
    div.innerHTML = `
      <h1>Instructions</h1>
      <p class="field-hint">A quick tour of the assessment. Each step also has its own on-page guidance. This is just the map.</p>

      <ol class="instructions-steps">
        <li>
          <h2>Initial Setup</h2>
          <p>Enter how many meta-analyses you're assessing. The app builds one "Step 1" and one "Step 4" page per meta-analysis automatically.</p>
        </li>
        <li>
          <h2>Step 1. Select and define meta-analyses</h2>
          <p>For each meta-analysis, record the PICO elements and eligibility criteria (participants, intervention, comparator, outcome, study designs, outcome definitions, methods of analysis) that will be assessed for risk of bias due to missing evidence.</p>
        </li>
        <li>
          <h2>Step 2. Results matrix</h2>
          <p>List every study meeting the inclusion criteria and mark, for each meta-analysis, whether its results are available, partially available, unclear, or missing.</p>
        </li>
        <li>
          <h2>Step 3. Circumstances across the review</h2>
          <p>Answer a small set of review-wide questions about circumstances that indicate a potential for missing studies (e.g. reliance on prospective registration, evidence of selective reporting).</p>
        </li>
        <li>
          <h2>Step 4. Assess risk of bias</h2>
          <p>For each meta-analysis, work through the guided questions to reach a suggested risk-of-bias judgement, then record your final judgement, direction of bias, and remarks. Forest/funnel plot images can be attached here.</p>
        </li>
        <li>
          <h2>Summary</h2>
          <p>Review a combined table of every meta-analysis's judgement, and export it as an Excel, Word, or image file.</p>
        </li>
      </ol>

      <div class="instructions-tip">
        <p>Prefer to fill in your answers in a spreadsheet first? <button type="button" class="link-button" data-action="download-template">Download a blank template save file</button> and use "Resume Progress" to load it back in once you're done.</p>
      </div>

      <details class="codebook-details">
        <summary>Saving &amp; resuming your progress</summary>

        <h3>Saving</h3>
        <ol class="instructions-steps">
          <li>
            <h4>Click "Save Progress"</h4>
            <p>Available in the header or footer of every page. Nothing needs to be finished first. You can save at any point.</p>
          </li>
          <li>
            <h4>A <code>.csv</code> file downloads automatically</h4>
            <p>Named <code>rob-me_progress.csv</code>. It contains every answer you've entered across every step, in a plain spreadsheet-friendly format.</p>
          </li>
          <li>
            <h4>If you've uploaded any forest/funnel plots, image files download too</h4>
            <p>Named like <code>rob-me_ma1_forest_plot.png</code>, one per plot you've uploaded. A message lists exactly which image files were downloaded.</p>
          </li>
        </ol>
        <div class="callout tip">
          <p><b>Keep everything together.</b> Move the CSV and any image files into the same folder (e.g. a folder for this systematic review) so you don't lose track of which images belong with which save file.</p>
        </div>

        <h3>Resuming</h3>
        <ol class="instructions-steps">
          <li>
            <h4>Click "Resume Progress"</h4>
            <p>Opens a dialog with a required progress file field and two optional plot image pickers.</p>
          </li>
          <li>
            <h4>Select your <code>rob-me_progress.csv</code> file</h4>
            <p>This is required. It's the "Progress file" field.</p>
          </li>
          <li>
            <h4>Select any plot image files (optional)</h4>
            <p>Use the "Forest plot images" and "Funnel plot images" fields (each accepts multiple files at once). For every image you add, a row appears where you pick which meta-analysis it belongs to and confirm its plot type. Skip this entirely if your assessment had no plots.</p>
          </li>
          <li>
            <h4>Click "Load Progress"</h4>
            <p>Your answers are restored exactly where you left off. If anything in the file couldn't be read correctly, you'll see a clear message explaining what and why.</p>
          </li>
        </ol>
        <div class="callout warning">
          <p><b>If you skip the image files</b>, your text answers still load correctly. You'll just see a note listing which plots are missing, and you can re-upload them individually on the relevant Step 4 page.</p>
        </div>

        <h3>Forest &amp; funnel plot images</h3>
        <table class="codebook">
          <tr><th>Accepted file types</th><td>PNG or JPEG recommended. GIF, WebP, and BMP are also accepted, but PNG/JPEG are the safest choice for compatibility with the exported Word/Excel reports.</td></tr>
          <tr><th>Recommended resolution</th><td>At least 800×600 pixels. Smaller images will still upload, but may look blurry once embedded in an exported report.</td></tr>
          <tr><th>File size</th><td>Under 10MB is recommended. Larger files still work, but will slow the app down and make your saved CSV+images bundle unwieldy. You'll see a warning if you upload something larger.</td></tr>
          <tr><th>Recommended filename convention</th><td>Name your image files <code>forest_MA1.png</code> / <code>funnel_MA1.png</code> (plot type + meta-analysis number). Not required, but when resuming, a filename in this style automatically pre-fills that image's plot type and meta-analysis dropdowns (still editable). Type/number can appear in either order, separated by <code>_</code>, <code>-</code>, a space, or nothing, and matching is case-insensitive.</td></tr>
          <tr><th>Assigning images on resume</th><td>Filenames don't otherwise need to match anything. Upload each image under "Forest plot images" or "Funnel plot images" and pick its meta-analysis number from the dropdown next to it. The app doesn't need to already know about the file.</td></tr>
        </table>

        <h3>Troubleshooting</h3>
        <table class="codebook">
          <thead><tr><th>Message you see</th><th>What it means</th><th>What to do</th></tr></thead>
          <tbody>
            <tr><td>"Please select a valid ROB-ME progress CSV file…"</td><td>The file's first row is not the expected <code>varname,value</code> header</td><td>Use an unmodified <code>rob-me_progress.csv</code>, or download a blank template from this page ("Download a blank template save file")</td></tr>
            <tr><td>"This file contains N invalid value(s) and cannot be loaded…"</td><td>A dropdown or number field contains a value outside what's listed in the codebook below</td><td>Correct the listed cell(s) in a spreadsheet application, then try again</td></tr>
            <tr><td>"…field(s) in the file were not recognized and have been ignored"</td><td>The file has extra columns/rows the app doesn't use. Everything else still loaded</td><td>Usually harmless; check for a typo if you expected that field to matter</td></tr>
            <tr><td>"…referenced image file(s) were not provided and are missing"</td><td>The CSV mentions a plot image you didn't upload and assign to a meta-analysis</td><td>Upload the image under "Forest plot images" or "Funnel plot images" and assign it, or re-upload the plot manually on Step 4</td></tr>
            <tr><td>"…which exceeds the maximum this tool supports…"</td><td><code>n_ma</code> or <code>n_studies</code> is an implausibly large number, likely a corrupted file</td><td>Check that the file was not damaged or edited incorrectly</td></tr>
          </tbody>
        </table>
      </details>

      <details class="codebook-details">
        <summary>CSV field reference, what to type into each cell</summary>

        <p class="field-hint">Every row in the CSV is one <code>varname,value</code> pair. <code>{i}</code> = meta-analysis number (1, 2, 3…), <code>{y}</code> = study row number, <code>{x}</code> = meta-analysis number specifically in Step 2's results grid.</p>

        <div class="callout warning">
          <p><b>Dropdown fields only accept the exact text shown below</b> (or a blank cell). Anything else (a typo, different capitalization, extra spacing) will be rejected when you try to resume, with a message telling you exactly which field and value was the problem.</p>
        </div>

        <table class="codebook">
          <caption>Initial Setup</caption>
          <thead><tr><th>Field</th><th>Description</th><th>Accepted values</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td><code>n_ma</code></td><td>Number of meta-analyses being assessed</td><td>Whole number, 1 or more</td><td><code>3</code></td></tr>
            <tr><td><code>n_studies</code></td><td>Number of study rows in Step 2's results matrix</td><td>Whole number, 1 or more</td><td><code>12</code></td></tr>
          </tbody>
        </table>

        <table class="codebook">
          <caption>Step 1. Select and define meta-analyses (per meta-analysis <code>{i}</code>)</caption>
          <thead><tr><th>Field</th><th>Description</th><th>Accepted values</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td><code>{i}_p</code></td><td>Participants</td><td>Free text</td><td>Patients with shoulder pain</td></tr>
            <tr><td><code>{i}_i</code></td><td>Intervention(s)</td><td>Free text</td><td>Ibuprofen</td></tr>
            <tr><td><code>{i}_c</code></td><td>Comparator</td><td>Free text</td><td>Placebo</td></tr>
            <tr><td><code>{i}_o</code></td><td>Outcome</td><td>Free text</td><td>Pain intensity at 0–12 weeks</td></tr>
            <tr><td><code>{i}_ds</code></td><td>Eligible study designs</td><td>Free text</td><td>Randomised trials</td></tr>
            <tr><td><code>{i}_oc</code></td><td>Eligible outcome definitions</td><td>Free text</td><td>Any validated pain scale</td></tr>
            <tr><td><code>{i}_met</code></td><td>Eligible methods of analysis</td><td>Free text</td><td>Crude or adjusted estimates</td></tr>
          </tbody>
        </table>

        <table class="codebook">
          <caption>Step 2. Results matrix</caption>
          <thead><tr><th>Field</th><th>Description</th><th>Accepted values</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td><code>{y}_id</code></td><td>Study ID</td><td>Free text</td><td>Smith 2025</td></tr>
            <tr><td><code>{y}_source</code></td><td>Source(s) used</td><td>Free text</td><td>PMID 12345678</td></tr>
            <tr><td><code>{y}_ss</code></td><td>Number of participants in this study</td><td>Whole number, 0 or more</td><td>240</td></tr>
            <tr><td><code>{x}_{y}_results</code></td><td>Results availability for meta-analysis <code>{x}</code>, study <code>{y}</code></td><td>Blank, <code>✓</code>, <code>~</code>, <code>?</code>, or <code>X</code></td><td><code>X</code></td></tr>
            <tr><td><code>{i}_step2_ma_rm</code></td><td>Remarks for meta-analysis <code>{i}</code></td><td>Free text</td><td>-</td></tr>
          </tbody>
        </table>

        <table class="codebook">
          <caption>Step 3. Circumstances indicating potential for missing studies</caption>
          <thead><tr><th>Field</th><th>Description</th><th>Accepted values</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td><code>q3_1_results</code></td><td>Q3.1 answer</td><td>Blank, Yes, No</td><td>No</td></tr>
            <tr><td><code>q3_2_results</code></td><td>Q3.2 answer</td><td>Blank, Not applicable, Yes, Probably yes, Probably no, No</td><td>Probably yes</td></tr>
            <tr><td><code>q3_3_results</code></td><td>Q3.3 answer</td><td>Same as Q3.2</td><td>No</td></tr>
            <tr><td><code>q3_overall</code></td><td>Overall conclusion</td><td>Blank, Yes, No</td><td>Yes</td></tr>
            <tr><td><code>q3_rm</code></td><td>Remarks</td><td>Free text</td><td>-</td></tr>
          </tbody>
        </table>

        <table class="codebook">
          <caption>Step 4. Assess risk of bias (per meta-analysis <code>{i}</code>)</caption>
          <thead><tr><th>Field</th><th>Description</th><th>Accepted values</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td><code>{i}_title</code></td><td>Title/description of the meta-analysis</td><td>Free text</td><td>Ibuprofen vs placebo for shoulder pain</td></tr>
            <tr><td><code>{i}_result</code></td><td>Synthesized result</td><td>Free text</td><td>MD -0.5 (95% CI -0.9 to -0.1)</td></tr>
            <tr><td><code>{i}_ma_n_study</code></td><td>Number of included studies</td><td>Whole number, 0 or more</td><td>5</td></tr>
            <tr><td><code>{i}_ma_ss</code></td><td>Number of included participants</td><td>Whole number, 0 or more</td><td>1234</td></tr>
            <tr><td><code>{i}_q4_1</code></td><td>Q4.1 (auto-filled from Step 2)</td><td>Blank, Yes, No</td><td>Yes</td></tr>
            <tr><td><code>{i}_q4_2</code></td><td>Q4.2</td><td>Blank, Yes, Probably yes, Probably no, No, No information</td><td>Probably yes</td></tr>
            <tr><td><code>{i}_q4_3</code></td><td>Q4.3 (auto-filled from Step 2)</td><td>Blank, Yes, No</td><td>No</td></tr>
            <tr><td><code>{i}_q4_4</code></td><td>Q4.4</td><td>Same as Q4.2</td><td>No</td></tr>
            <tr><td><code>{i}_q4_5</code></td><td>Q4.5 (auto-filled from Step 3)</td><td>Blank, Yes, No</td><td>No</td></tr>
            <tr><td><code>{i}_q4_6</code></td><td>Q4.6</td><td>Blank, Yes, Probably yes, Probably no, No</td><td>-</td></tr>
            <tr><td><code>{i}_q4_7</code></td><td>Q4.7</td><td>Same as Q4.6</td><td>No</td></tr>
            <tr><td><code>{i}_q4_8</code></td><td>Q4.8</td><td>Same as Q4.6</td><td>-</td></tr>
            <tr><td><code>{i}_rob_suggested</code></td><td>Suggested ROB judgement (auto-calculated, recalculated every time the app loads, so manual edits here won't stick)</td><td>Blank, Low, Some concerns, High</td><td>Low</td></tr>
            <tr><td><code>{i}_rob_final</code></td><td>Final ROB judgement (your actual judgement)</td><td>Blank, Low, Some concerns, High</td><td>Some concerns</td></tr>
            <tr><td><code>{i}_rob_dir</code></td><td>Predicted direction of bias (optional)</td><td>Blank, Favours experimental, Favours comparator, Towards null, Away from null, Unpredictable</td><td>Towards null</td></tr>
            <tr><td><code>{i}_rob_rm</code></td><td>Remarks supporting judgement</td><td>Free text</td><td>-</td></tr>
            <tr><td><code>{i}_forest_plot_data</code></td><td>Forest plot image filename</td><td>Blank, or the exact filename of an uploaded image</td><td>rob-me_ma1_forest_plot.png</td></tr>
            <tr><td><code>{i}_funnel_plot_data</code></td><td>Funnel plot image filename</td><td>Same as forest plot</td><td>rob-me_ma1_funnel_plot.png</td></tr>
          </tbody>
        </table>

        <table class="codebook">
          <caption>Summary</caption>
          <thead><tr><th>Field</th><th>Description</th><th>Accepted values</th><th>Example</th></tr></thead>
          <tbody>
            <tr><td><code>output_title</code></td><td>Title shown on the summary table and in exported reports</td><td>Free text</td><td>Shoulder Pain Review - ROB-ME Assessment</td></tr>
          </tbody>
        </table>
      </details>
    `;
    div.querySelector('[data-action="download-template"]').addEventListener("click", downloadTemplateCsv);
    return div;
  }

  function renderAbout() {
    const div = document.createElement("div");
    div.className = "about-page";
    div.innerHTML = `
      <h1>About ROB-ME</h1>
      <p class="about-intro">Risk Of Bias due to Missing Evidence (ROB-ME) is a tool for assessing risk of bias due to missing evidence in systematic reviews with meta-analysis.</p>

      <section class="about-section">
        <h2>ROB-ME Development Group</h2>
        <p>Matthew J Page, Jonathan AC Sterne, Isabelle Boutron, Asbjørn Hróbjartsson, Jamie J Kirkham, Tianjing Li, Andreas Lundh, Evan Mayo-Wilson,
        Joanne E McKenzie, Lesley A Stewart, Alex J Sutton, Lisa Bero, Adam G Dunn, Kerry Dwan, Roy G Elbers, Raju Kanukula, Joerg J Meerpohl, Erick H Turner, Julian PT Higgins</p>
      </section>

      <section class="about-section">
        <h2>Correspondence to</h2>
        <p>A/Prof Matthew Page, Methods in Evidence Synthesis Unit, School of Public Health and Preventive Medicine, Monash University.
        <br><a href="mailto:matthew.page@monash.edu">matthew.page@monash.edu</a></p>
      </section>

      <section class="about-section">
        <h2>Resources</h2>
        <ul class="about-resources">
          <li><a href="https://drive.google.com/file/d/1jceuWTo3nbrOrJcGxiXW6naLc32tDsfU" target="_blank" rel="noopener">A crib sheet summarizing the tool</a></li>
          <li><a href="https://www.youtube.com/watch?v=U6fwKFBYAyo" target="_blank" rel="noopener">A video demonstrating how to use the tool</a></li>
        </ul>
      </section>

      <section class="about-section">
        <h2>Citation</h2>
        <p class="citation">Page MJ, Sterne JAC, Boutron I, Hróbjartsson A, Kirkham JJ, Li T, Lundh A, Mayo-Wilson E, McKenzie JE, Stewart LA, Sutton AJ, Bero L, Dunn AG, Dwan K, Elbers RG,
        Kanukula R, Meerpohl JJ, Turner EH, Higgins JPT. ROB-ME: a tool for assessing risk of bias due to missing evidence in systematic reviews with meta-analysis. BMJ 2023;383:e076754. DOI: 10.1136/bmj-2023-076754.</p>
      </section>

      <section class="about-section">
        <p class="about-credit">This app was built by Phoebe Nguyen. For any feedback about the app, contact <a href="mailto:phoebe.nguyen@monash.edu">phoebe.nguyen@monash.edu</a>.</p>
      </section>

      <section class="about-section">
        <p class="license">This work is licensed under a <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.en" target="_blank" rel="noopener">Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License.</a></p>
      </section>
    `;
    return div;
  }

  // Auto-grows a textarea to fit its content instead of scrolling inside a
  // fixed-size box. RAF-deferred so scrollHeight reflects real layout once
  // the element is actually attached to the document.
  function autoGrowTextarea(textarea) {
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.style.overflowY = "hidden";
    textarea.addEventListener("input", resize);
    requestAnimationFrame(resize);
  }

  // DOM ids can't safely start with a digit (breaks CSS-selector lookups),
  // but state keys must match the R app's variable naming (e.g. "1_p") for
  // JSON save-file compatibility — so the DOM id and the state key differ.
  function fieldTextarea(key, labelHtml) {
    const domId = `field-${key}`;
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const label = document.createElement("label");
    label.innerHTML = labelHtml;
    label.setAttribute("for", domId);
    const textarea = document.createElement("textarea");
    textarea.id = domId;
    textarea.rows = 2;
    textarea.value = state.answers[key] || "";
    textarea.addEventListener("input", () => {
      state.answers[key] = textarea.value;
      scheduleAutosave();
      updateCurrentStepperPill();
    });
    autoGrowTextarea(textarea);
    wrapper.appendChild(label);
    wrapper.appendChild(textarea);
    return wrapper;
  }

  // Single source of truth for every risk-of-bias color in the app — three
  // schemes only: "active" (a user's own answer: Q3/Q4 selects when
  // enabled, rob_final, the Step 2 results grid, the Summary table, and
  // every export) and "muted" (an automatically generated/disabled answer:
  // Q3/Q4 auto-fills, rob_suggested). Ports the R app's colorResultsSelects()
  // color language — teal/amber/peach/grey by concern level. Everything
  // elsewhere in this file that needs a risk color derives it from here so
  // the three contexts can never drift out of sync with each other.
  const DECISION_COLORS = {
    teal: { active: "#B8EBD8", muted: "#D1F2E6" },
    amber: { active: "#FFE082", muted: "#FFEBAE" },
    peach: { active: "#FFDAB5", muted: "#FFE7CF" },
  };

  const STEP2_RESULT_CHOICES = ["", "✓", "~", "?", "X"];
  const STEP2_RESULT_COLORS = {
    "✓": DECISION_COLORS.teal.active,
    "~": DECISION_COLORS.teal.active,
    "?": DECISION_COLORS.amber.active,
    "X": DECISION_COLORS.peach.active,
  };

  function applyResultColor(select) {
    const color = STEP2_RESULT_COLORS[select.value];
    select.style.backgroundColor = color || "";
    select.style.color = color ? "#000" : "";
  }

  function fieldSelectResult(key, ariaLabel) {
    const select = document.createElement("select");
    select.id = `field-${key}`;
    select.className = "step2-result-select";
    if (ariaLabel) select.setAttribute("aria-label", ariaLabel);
    STEP2_RESULT_CHOICES.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice;
      option.textContent = choice;
      select.appendChild(option);
    });
    select.value = state.answers[key] || "";
    applyResultColor(select);
    select.addEventListener("change", () => {
      state.answers[key] = select.value;
      applyResultColor(select);
      scheduleAutosave();
      updateCurrentStepperPill();
    });
    return select;
  }

  function fieldTextInput(key, ariaLabel) {
    const input = document.createElement("input");
    input.type = "text";
    input.id = `field-${key}`;
    if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
    input.value = state.answers[key] || "";
    input.addEventListener("input", () => {
      state.answers[key] = input.value;
      scheduleAutosave();
      updateCurrentStepperPill();
    });
    return input;
  }

  function fieldNumberInput(key, min, ariaLabel) {
    const input = document.createElement("input");
    input.type = "number";
    input.id = `field-${key}`;
    if (min !== undefined) input.min = min;
    if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
    input.value = state.answers[key] !== undefined ? state.answers[key] : 0;
    input.addEventListener("input", () => {
      state.answers[key] = input.value === "" ? "" : Number(input.value);
      scheduleAutosave();
    });
    // Whole-number, non-negative fields (participant/study counts) accept
    // free typing while the user is mid-entry (the "input" listener above),
    // but get rounded/clamped to a valid whole number once they leave the
    // field — same pattern as the Setup n_ma field's correction-on-change.
    if (min !== undefined) {
      input.addEventListener("change", () => {
        if (input.value === "") return;
        const corrected = Math.max(min, Math.round(Number(input.value) || 0));
        input.value = corrected;
        state.answers[key] = corrected;
        scheduleAutosave();
      });
    }
    return input;
  }

  function fieldTextareaPlain(key, rows, ariaLabel) {
    const textarea = document.createElement("textarea");
    textarea.id = `field-${key}`;
    textarea.rows = rows || 2;
    textarea.className = "step2-remarks";
    if (ariaLabel) textarea.setAttribute("aria-label", ariaLabel);
    textarea.value = state.answers[key] || "";
    textarea.addEventListener("input", () => {
      state.answers[key] = textarea.value;
      scheduleAutosave();
    });
    autoGrowTextarea(textarea);
    return textarea;
  }

  // Fixed per-column widths (rem) for Step 2's results matrix. Each results
  // column stays a legible, constant size no matter how large n_ma gets.
  //
  // "Freeze panes" (like Excel) is implemented as two genuinely separate
  // DOM trees rather than position:sticky cells within one scrolling grid:
  // a non-scrolling .step2-frozen-col (Study ID/Source/Participants) next
  // to an independently horizontally-scrolling .step2-scroll-col (the
  // results matrix + remove button), built row-for-row in parallel. This
  // was chosen over sticky positioning after finding that many sticky grid
  // cells side by side (one per row, per frozen column) hit a real
  // Chromium rendering bug where non-positioned scrolled content visibly
  // painted over the sticky cells despite element-order/z-index and
  // elementFromPoint hit-testing both confirming the sticky cell was
  // correctly on top — i.e. a compositor paint-order bug, not a CSS logic
  // bug. Two separate non-overlapping panes have nothing to paint over.
  const STEP2_COL_W = { id: 9, source: 8, participants: 6, result: 2.75, remove: 2.5 };

  function step2KeyTable() {
    const wrap = document.createElement("div");
    wrap.className = "step2-key";
    wrap.innerHTML = `
      <b>Key for Results availability</b>
      <table class="step2-key-table">
        <tr><td class="key-cell" style="background:${STEP2_RESULT_COLORS["✓"]};">✓</td><td>A study result is available for inclusion in the meta-analysis.</td></tr>
        <tr><td class="key-cell" style="background:${STEP2_RESULT_COLORS["~"]};">~</td><td>No study result is available for inclusion in the meta-analysis, for a reason unrelated to the P value, magnitude or direction of the result.</td></tr>
        <tr><td class="key-cell" style="background:${STEP2_RESULT_COLORS["?"]};">?</td><td>Unclear whether an eligible study result was generated.</td></tr>
        <tr><td class="key-cell" style="background:${STEP2_RESULT_COLORS["X"]};">X</td><td>No study result is available for inclusion in the meta-analysis, likely because of the P value, magnitude or direction of the result generated.</td></tr>
      </table>
    `;
    return wrap;
  }

  function addStudyStep2() {
    state.answers.n_studies = (Number(state.answers.n_studies) || 1) + 1;
    scheduleAutosave();
    render();
  }

  // Mirrors the R app's remove-row logic: shift every subsequent row's data
  // up by one index, then delete the now-duplicate last row.
  function removeStudyStep2(rowNum) {
    const n_studies = Number(state.answers.n_studies) || 1;
    if (n_studies <= 1) {
      alert("Cannot remove the last study.");
      return;
    }
    const n_ma = Number(state.answers.n_ma) || 1;
    const unifiedFields = ["id", "source", "ss"];
    for (let i = rowNum; i < n_studies; i++) {
      unifiedFields.forEach((field) => {
        const currentKey = `${i}_${field}`;
        const nextKey = `${i + 1}_${field}`;
        if (state.answers[nextKey] !== undefined) {
          state.answers[currentKey] = state.answers[nextKey];
        } else {
          delete state.answers[currentKey];
        }
      });
      for (let x = 1; x <= n_ma; x++) {
        const currentResKey = `${x}_${i}_results`;
        const nextResKey = `${x}_${i + 1}_results`;
        if (state.answers[nextResKey] !== undefined) {
          state.answers[currentResKey] = state.answers[nextResKey];
        } else {
          delete state.answers[currentResKey];
        }
      }
    }
    unifiedFields.forEach((field) => delete state.answers[`${n_studies}_${field}`]);
    for (let x = 1; x <= n_ma; x++) delete state.answers[`${x}_${n_studies}_results`];
    state.answers.n_studies = n_studies - 1;
    scheduleAutosave();
    render();
  }

  // Client-side filter for large results matrices — hides non-matching rows
  // live as the user types, reading each row's Study ID input directly so it
  // stays in sync even while someone is still typing IDs in. Each study's
  // frozen-pane row and scroll-pane row are two separate elements (see
  // STEP2_COL_W's comment) sharing a data-study-row index, so both have to
  // be toggled together or the two panes drift out of vertical sync.
  function step2SearchBox() {
    const wrap = document.createElement("div");
    wrap.className = "step2-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Filter by Study ID…";
    input.setAttribute("aria-label", "Filter studies by Study ID");
    input.addEventListener("input", () => {
      const term = input.value.trim().toLowerCase();
      document.querySelectorAll(".step2-frozen-col .step2-row[data-study-row]").forEach((frozenRow) => {
        const y = frozenRow.dataset.studyRow;
        const idInput = frozenRow.querySelector('input[type="text"]');
        const matches = !term || (idInput && idInput.value.toLowerCase().includes(term));
        const display = matches ? "" : "none";
        frozenRow.style.display = display;
        const scrollRow = document.querySelector(`.step2-scroll-col .step2-row[data-study-row="${y}"]`);
        if (scrollRow) scrollRow.style.display = display;
      });
    });
    wrap.appendChild(input);
    return wrap;
  }

  function renderStep2() {
    const div = document.createElement("div");
    div.appendChild(stepBanner(
      "Step 2. Determine which studies meeting the inclusion criteria for the meta-analyses have missing results"
    ));
    div.appendChild(step2KeyTable());

    // Persist the default immediately (matching the R app), so a single-row
    // Step 2 is actually saved/exported even if "+ Add study" is never clicked.
    if (!(Number(state.answers.n_studies) >= 1)) state.answers.n_studies = 1;
    const n_ma = Number(state.answers.n_ma) || 1;
    const n_studies = Number(state.answers.n_studies) || 1;
    if (n_studies > 1) div.appendChild(step2SearchBox());
    const frozenTemplate = `${STEP2_COL_W.id}rem ${STEP2_COL_W.source}rem ${STEP2_COL_W.participants}rem`;
    const scrollTemplate = `repeat(${n_ma}, ${STEP2_COL_W.result}rem) ${STEP2_COL_W.remove}rem`;

    const table = document.createElement("div");
    table.className = "step2-table";

    const frozenCol = document.createElement("div");
    frozenCol.className = "step2-frozen-col";

    const scrollOuter = document.createElement("div");
    scrollOuter.className = "step2-scroll-outer";
    const scrollCol = document.createElement("div");
    scrollCol.className = "step2-scroll-col";
    scrollOuter.appendChild(scrollCol);

    const fHeader1 = document.createElement("div");
    fHeader1.className = "step2-row step2-header";
    fHeader1.style.gridTemplateColumns = frozenTemplate;
    fHeader1.innerHTML = "<div><b>Study ID</b></div><div><b>Source(s) used</b></div><div><b>No. participants</b></div>";
    frozenCol.appendChild(fHeader1);

    const sHeader1 = document.createElement("div");
    sHeader1.className = "step2-row step2-header";
    sHeader1.style.gridTemplateColumns = scrollTemplate;
    const h1Results = document.createElement("div");
    h1Results.className = "step2-results-header";
    h1Results.innerHTML = "<b>Results available for meta-analysis</b>";
    h1Results.style.gridColumn = `span ${n_ma}`;
    sHeader1.appendChild(h1Results);
    sHeader1.appendChild(document.createElement("div"));
    scrollCol.appendChild(sHeader1);

    // fHeader1/sHeader1 are separate elements in separate DOM trees, so when
    // the results-header text wraps more than the frozen header's short
    // labels (e.g. n_ma=1 leaves it only one narrow result column to wrap
    // into), their natural heights diverge and every row below drifts out
    // of alignment. Measure both after they're mounted and force them equal.
    requestAnimationFrame(() => {
      const h = Math.max(fHeader1.offsetHeight, sHeader1.offsetHeight);
      fHeader1.style.minHeight = `${h}px`;
      sHeader1.style.minHeight = `${h}px`;
    });

    const fHeader2 = document.createElement("div");
    fHeader2.className = "step2-row step2-subheader";
    fHeader2.style.gridTemplateColumns = frozenTemplate;
    fHeader2.innerHTML = `
      <div class="field-hint">(e.g. Smith 2025)</div>
      <div class="field-hint">(e.g. PMID or DOI)</div>
      <div></div>
    `;
    frozenCol.appendChild(fHeader2);

    const sHeader2 = document.createElement("div");
    sHeader2.className = "step2-row step2-subheader";
    sHeader2.style.gridTemplateColumns = scrollTemplate;
    for (let x = 1; x <= n_ma; x++) {
      const cell = document.createElement("div");
      cell.className = "step2-ma-number";
      cell.textContent = x;
      sHeader2.appendChild(cell);
    }
    sHeader2.appendChild(document.createElement("div"));
    scrollCol.appendChild(sHeader2);

    for (let y = 1; y <= n_studies; y++) {
      const frozenRow = document.createElement("div");
      frozenRow.className = "step2-row";
      frozenRow.style.gridTemplateColumns = frozenTemplate;
      frozenRow.dataset.studyRow = y;

      const idCell = document.createElement("div");
      idCell.appendChild(fieldTextInput(`${y}_id`, `Study ${y} ID`));
      frozenRow.appendChild(idCell);

      const sourceCell = document.createElement("div");
      sourceCell.appendChild(fieldTextInput(`${y}_source`, `Study ${y} source(s) used`));
      frozenRow.appendChild(sourceCell);

      const ssCell = document.createElement("div");
      ssCell.appendChild(fieldNumberInput(`${y}_ss`, 0, `Study ${y} number of participants`));
      frozenRow.appendChild(ssCell);

      frozenCol.appendChild(frozenRow);

      const scrollRow = document.createElement("div");
      scrollRow.className = "step2-row";
      scrollRow.style.gridTemplateColumns = scrollTemplate;
      scrollRow.dataset.studyRow = y;

      for (let x = 1; x <= n_ma; x++) {
        const cell = document.createElement("div");
        cell.appendChild(fieldSelectResult(`${x}_${y}_results`, `Results available for meta-analysis ${x}, study ${y}`));
        scrollRow.appendChild(cell);
      }

      const removeCell = document.createElement("div");
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "−";
      removeBtn.className = "step2-remove-btn";
      removeBtn.addEventListener("click", () => removeStudyStep2(y));
      removeCell.appendChild(removeBtn);
      scrollRow.appendChild(removeCell);

      scrollCol.appendChild(scrollRow);
    }

    table.appendChild(frozenCol);
    table.appendChild(scrollOuter);
    div.appendChild(table);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Add study";
    addBtn.className = "step2-add-btn";
    addBtn.addEventListener("click", addStudyStep2);
    div.appendChild(addBtn);

    div.appendChild(document.createElement("hr"));

    const remarksHeading = document.createElement("h3");
    remarksHeading.textContent = "Remarks";
    div.appendChild(remarksHeading);

    for (let i = 1; i <= n_ma; i++) {
      const remarksWrap = document.createElement("div");
      const label = document.createElement("label");
      label.className = "step2-remarks-heading";
      label.setAttribute("for", `field-${i}_step2_ma_rm`);
      label.innerHTML = `<b>Meta-analysis ${i}</b>`;
      remarksWrap.appendChild(label);
      remarksWrap.appendChild(fieldTextareaPlain(`${i}_step2_ma_rm`, 3));
      div.appendChild(remarksWrap);
    }

    return div;
  }

  const Q3_1_CHOICES = ["", "Yes", "No"];
  const Q3_2_3_CHOICES = ["", "Not applicable", "Yes", "Probably yes", "Probably no", "No"];
  const Q3_OVERALL_CHOICES = ["", "Yes", "No"];
  const YES_PROBABLY_YES = ["Yes", "Probably yes"];
  const NO_PROBABLY_NO = ["No", "Probably no"];

  function decisionColorCategory(value, inverted) {
    if (inverted) {
      if (YES_PROBABLY_YES.includes(value)) return "teal";
      if (NO_PROBABLY_NO.includes(value)) return "peach";
      if (value === "Not applicable") return "grey";
      return null;
    }
    if (["✓", "~", "No", "Probably no", "Low"].includes(value)) return "teal";
    if (value === "?" || value === "Some concerns") return "amber";
    if (["X", "Yes", "Probably yes", "High"].includes(value)) return "peach";
    if (value === "Not applicable" || value === "No information") return "grey";
    return null;
  }

  function applyDecisionColor(select, inverted) {
    const category = decisionColorCategory(select.value, inverted);
    if (!category) {
      select.style.backgroundColor = "";
      select.style.color = "";
      return;
    }
    if (category === "grey") {
      select.style.backgroundColor = "#D3D3D3";
    } else {
      const scheme = DECISION_COLORS[category];
      select.style.backgroundColor = select.disabled ? scheme.muted : scheme.active;
    }
    select.style.color = "#000";
  }

  function fieldSelectPlain(key, choices, opts) {
    opts = opts || {};
    const select = document.createElement("select");
    select.id = `field-${key}`;
    if (opts.ariaLabel) select.setAttribute("aria-label", opts.ariaLabel);
    choices.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice;
      option.textContent = choice;
      select.appendChild(option);
    });
    select.value = state.answers[key] || "";
    select.disabled = !!opts.disabled;
    if (opts.decisionColor) applyDecisionColor(select, opts.inverted);
    select.addEventListener("change", () => {
      state.answers[key] = select.value;
      if (opts.decisionColor) applyDecisionColor(select, opts.inverted);
      scheduleAutosave();
      // triggerCascade already re-renders the whole page (Step 3/4's
      // disabled-state and auto-fills can change), which rebuilds the
      // stepper as part of that — no need to also refresh the pill here,
      // that would just repeat the same work twice.
      if (opts.triggerCascade) render();
      else updateCurrentStepperPill();
    });
    return select;
  }

  // Mirrors the R app's reactive `observe` block for Step 3: re-derives Q3.2/
  // Q3.3's enabled state + value, and auto-fills q3_overall, from Q3.1-Q3.3's
  // current values. Runs on page-enter and whenever Q3.1/Q3.2/Q3.3 change —
  // but NOT when q3_overall itself changes, so a manual override of the
  // suggested answer isn't immediately clobbered by editing it.
  function applyStep3Cascade() {
    const q1 = state.answers.q3_1_results || "";
    let q2 = state.answers.q3_2_results || "";
    let q3 = state.answers.q3_3_results || "";

    if (q1 === "No") {
      if (q2 === "Not applicable") q2 = "";
    } else if (q1 === "Yes") {
      q2 = "Not applicable";
    } else {
      q2 = "";
    }

    if (YES_PROBABLY_YES.includes(q2)) {
      if (q3 === "Not applicable") q3 = "";
    } else if (NO_PROBABLY_NO.includes(q2) || q2 === "Not applicable") {
      q3 = "Not applicable";
    } else {
      q3 = "";
    }

    state.answers.q3_2_results = q2;
    state.answers.q3_3_results = q3;

    // q3_overall re-derivation is gated on Q3.1/Q3.2/Q3.3 actually having
    // changed since we last computed it (tracked in step3CascadeMemo, kept
    // outside state.answers so it isn't picked up by hasMeaningfulProgress()
    // or CSV export). Without this gate, this function — which runs on
    // every ordinary page-enter, not just real edits — would silently
    // overwrite a manual override of q3_overall (or one loaded from a save
    // file) the moment the user merely navigated away and back, even though
    // the UI advertises this field as "suggested from your Q3.1–Q3.3
    // answers. You can override this." A different state.answers object
    // (fresh session, import, restore) resets the memo so the freshly
    // loaded value is trusted as-is rather than immediately recomputed.
    const seed = `${q1}|${q2}|${q3}`;
    const isFreshAnswers = !step3CascadeMemo || step3CascadeMemo.answersRef !== state.answers;
    const changed = !isFreshAnswers && step3CascadeMemo.seed !== seed;
    step3CascadeMemo = { answersRef: state.answers, seed };

    if (changed) {
      let overall = state.answers.q3_overall || "";
      if (q1 === "Yes") {
        overall = "No";
      } else if (q1 === "No") {
        if (NO_PROBABLY_NO.includes(q2)) {
          overall = "Yes";
        } else if (YES_PROBABLY_YES.includes(q2)) {
          if (NO_PROBABLY_NO.includes(q3)) overall = "Yes";
          else if (YES_PROBABLY_YES.includes(q3)) overall = "No";
          // else Q3.3 unanswered — leave overall as-is
        }
        // else Q3.2 unanswered — leave overall as-is
      }
      // else Q3.1 unanswered — leave overall as-is
      state.answers.q3_overall = overall;
    }

    // Q4.5 on every meta-analysis's Step 4 page is auto-filled from
    // q3_overall (applyStep4Cascade), but that function only otherwise runs
    // when a given Step 4 page is actually rendered — so without this, a
    // meta-analysis whose Step 4 page isn't revisited after a Step 3 change
    // would keep showing a stale Q4.5/suggested judgement (and stale
    // Q4.6/4.7/4.8 enabled-state) until the user happened to click through
    // to it. Refresh every meta-analysis's Step 4 state here instead, so a
    // Step 3 change propagates to Q4.5 everywhere immediately, not just on
    // the currently-viewed page.
    const n_ma = Number(state.answers.n_ma) || 1;
    for (let i = 1; i <= n_ma; i++) applyStep4Cascade(i);
  }

  function step3Question(labelHtml, hintText, key, choices, disabled, triggerCascade, autoFillNote, inverted) {
    const row = document.createElement("div");
    row.className = "step3-row";
    const textCol = document.createElement("div");
    textCol.className = "step3-text";
    const q = document.createElement("label");
    q.className = "step3-question";
    q.setAttribute("for", `field-${key}`);
    q.innerHTML = labelHtml;
    textCol.appendChild(q);
    if (hintText) {
      const hint = document.createElement("p");
      hint.className = "field-hint";
      hint.textContent = hintText;
      textCol.appendChild(hint);
    }
    if (autoFillNote) {
      const note = document.createElement("p");
      note.className = "auto-fill-note";
      note.textContent = `↳ ${autoFillNote}`;
      textCol.appendChild(note);
    }
    row.appendChild(textCol);
    const selectCol = document.createElement("div");
    selectCol.className = "step3-select";
    selectCol.appendChild(fieldSelectPlain(key, choices, { disabled, triggerCascade, decisionColor: true, inverted }));
    row.appendChild(selectCol);
    return row;
  }

  function renderStep3() {
    applyStep3Cascade();

    const div = document.createElement("div");
    div.appendChild(stepBanner(
      "Step 3: Consider circumstances indicating potential for missing studies across the review"
    ));

    div.appendChild(step3Question(
      "Q3.1. Were prospectively registered studies or studies identified for a prospective meta-analysis the only type of study eligible for inclusion in the review?",
      "Answer ‘No’ if studies were eligible for inclusion regardless of whether they were prospectively registered, or if this was not a prospective meta-analysis.",
      "q3_1_results", Q3_1_CHOICES, false, true, null, true
    ));

    const q2Disabled = (state.answers.q3_1_results || "") !== "No";
    div.appendChild(step3Question(
      "Q3.2. Would you expect information about every eligible study to be made publicly available regardless of their results?",
      "Answer ‘Yes/Probably yes’ if this is a research area for which you expect all studies to have been prospectively registered, or if there is another reason to expect information about every eligible study to be made publicly available regardless of their results (and specify the reason in the box below).",
      "q3_2_results", Q3_2_3_CHOICES, q2Disabled, true, null, true
    ));

    const q3Disabled = !YES_PROBABLY_YES.includes(state.answers.q3_2_results || "");
    div.appendChild(step3Question(
      "Q3.3. Were you likely to have found all eligible studies regardless of their results?",
      "Answer ‘Yes/Probably yes’ if you searched relevant trials registers and the search strategy was designed so that it would retrieve studies regardless of which outcomes were reported, or if there was another reason why you expect to have found all eligible studies regardless of their results (and specify the reason in the box below).",
      "q3_3_results", Q3_2_3_CHOICES, q3Disabled, true, null, true
    ));

    div.appendChild(step3Question(
      "Circumstances indicate potential for some eligible studies not being identified because of the P value, magnitude or direction of the results generated",
      null,
      "q3_overall", Q3_OVERALL_CHOICES, false, false,
      "Suggested from your Q3.1–Q3.3 answers. You can override this."
    ));

    const rmWrap = document.createElement("div");
    rmWrap.className = "field-inline";
    const rmLabel = document.createElement("label");
    rmLabel.setAttribute("for", "field-q3_rm");
    rmLabel.innerHTML = "<b>Remarks (optional)</b>";
    rmWrap.appendChild(rmLabel);
    rmWrap.appendChild(fieldTextareaPlain("q3_rm", 3));
    div.appendChild(rmWrap);

    return div;
  }

  const Q4_YN_CHOICES = ["", "Yes", "No"];
  const Q4_YPN_NI_CHOICES = ["", "Yes", "Probably yes", "Probably no", "No", "No information"];
  const Q4_YPN_CHOICES = ["", "Yes", "Probably yes", "Probably no", "No"];
  const ROB_CHOICES = ["", "Low", "Some concerns", "High"];
  const ROB_DIR_CHOICES = ["", "Favours experimental", "Favours comparator", "Towards null", "Away from null", "Unpredictable"];
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
        if (q4_5 === "No") {
          if (isAnswerEmpty(q4_7)) return conclude("");
          trail.push(`Q4.7 = ${q4_7}`);
          if (NO_PROBABLY_NO.includes(q4_7)) {
            if (isAnswerEmpty(q4_8)) return conclude("");
            trail.push(`Q4.8 = ${q4_8}`);
            if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
            if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
          }
          if (YES_PROBABLY_YES.includes(q4_7)) return conclude("High");
        }
        if (q4_5 === "Yes") {
          if (anyAnswerEmpty(q4_6, q4_7)) return conclude("");
          trail.push(`Q4.6 = ${q4_6}`, `Q4.7 = ${q4_7}`);
          if (NO_PROBABLY_NO.includes(q4_6)) {
            if (NO_PROBABLY_NO.includes(q4_7)) {
              if (isAnswerEmpty(q4_8)) return conclude("");
              trail.push(`Q4.8 = ${q4_8}`);
              if (NO_PROBABLY_NO.includes(q4_8)) return conclude("Some concerns");
              if (YES_PROBABLY_YES.includes(q4_8)) return conclude("High");
            }
            if (YES_PROBABLY_YES.includes(q4_7)) return conclude("High");
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

      const isQ42HighConcern = q4_1 === "Yes" && !isAnswerEmpty(q4_2) && YES_PROBABLY_YES.includes(q4_2);
      if (isQ42HighConcern) return conclude("High");
    }

    return conclude("");
  }

  function calculateRobSuggestion(q4_1, q4_2, q4_3, q4_4, q4_5, q4_6, q4_7, q4_8) {
    return calculateRobSuggestionDetailed(q4_1, q4_2, q4_3, q4_4, q4_5, q4_6, q4_7, q4_8).result;
  }

  function step4FoundMarkers(maIndex) {
    const n_studies = Number(state.answers.n_studies) || 1;
    let foundX = false;
    let foundQMark = false;
    for (let y = 1; y <= n_studies; y++) {
      const v = state.answers[`${maIndex}_${y}_results`];
      if (v === "X") foundX = true;
      if (v === "?") foundQMark = true;
    }
    return { foundX, foundQMark };
  }

  // Mirrors the R app's Step 4 `observe` block: auto-fills Q4.1/Q4.3/Q4.5 from
  // Step 2/3 data, enables/clears Q4.2/Q4.4/Q4.6/Q4.7/Q4.8 accordingly, and
  // recomputes the suggested ROB judgement. Runs on page-enter and whenever
  // Q4.2/Q4.4/Q4.6/Q4.7/Q4.8 change — never touches rob_final/rob_dir/rob_rm.
  function applyStep4Cascade(maIndex) {
    const { foundX, foundQMark } = step4FoundMarkers(maIndex);
    const isQ3Checked = state.answers.q3_overall === "Yes";

    state.answers[`${maIndex}_q4_1`] = foundX ? "Yes" : "No";
    const q4_2Enabled = foundX;
    if (!q4_2Enabled) state.answers[`${maIndex}_q4_2`] = "";

    state.answers[`${maIndex}_q4_3`] = foundQMark ? "Yes" : "No";
    const q4_4Enabled = foundQMark;
    if (!q4_4Enabled) state.answers[`${maIndex}_q4_4`] = "";

    state.answers[`${maIndex}_q4_5`] = isQ3Checked ? "Yes" : "No";
    const q4_6Enabled = isQ3Checked;
    if (!q4_6Enabled) state.answers[`${maIndex}_q4_6`] = "";

    const q4_7Enabled = foundX || foundQMark || isQ3Checked;
    if (!q4_7Enabled) state.answers[`${maIndex}_q4_7`] = "";

    const val2 = state.answers[`${maIndex}_q4_2`] || "";
    const val4 = state.answers[`${maIndex}_q4_4`] || "";
    const val6 = state.answers[`${maIndex}_q4_6`] || "";
    const val7 = state.answers[`${maIndex}_q4_7`] || "";
    const q4_8Enabled = YES_PROB_NO_INFO.includes(val2) || YES_PROB_NO_INFO.includes(val4) ||
      YES_PROBABLY_YES.includes(val6) || YES_PROBABLY_YES.includes(val7);
    if (!q4_8Enabled) state.answers[`${maIndex}_q4_8`] = "";

    const suggestion = calculateRobSuggestionDetailed(
      state.answers[`${maIndex}_q4_1`],
      state.answers[`${maIndex}_q4_2`],
      state.answers[`${maIndex}_q4_3`],
      state.answers[`${maIndex}_q4_4`],
      state.answers[`${maIndex}_q4_5`],
      state.answers[`${maIndex}_q4_6`],
      state.answers[`${maIndex}_q4_7`],
      state.answers[`${maIndex}_q4_8`]
    );
    state.answers[`${maIndex}_rob_suggested`] = suggestion.result;

    return { q4_2Enabled, q4_4Enabled, q4_6Enabled, q4_7Enabled, q4_8Enabled, robReasoning: suggestion.trail };
  }

  function step4DetailRow(labelText, inputEl, wide) {
    const row = document.createElement("div");
    row.className = "step4-detail-row";
    const label = document.createElement("label");
    label.className = "step4-detail-label";
    label.textContent = labelText;
    if (inputEl.id) label.setAttribute("for", inputEl.id);
    row.appendChild(label);
    const inputWrap = document.createElement("div");
    inputWrap.className = wide ? "step4-detail-input step4-detail-input-wide" : "step4-detail-input";
    inputWrap.appendChild(inputEl);
    row.appendChild(inputWrap);
    return row;
  }

  function step4SectionLabel(text, bold) {
    const p = document.createElement("p");
    p.innerHTML = bold === false ? text : `<b>${text}</b>`;
    return p;
  }

  function robReasoningDetails(trail) {
    const details = document.createElement("details");
    details.className = "rob-reasoning";
    const summary = document.createElement("summary");
    summary.textContent = "Why this suggestion?";
    details.appendChild(summary);
    const list = document.createElement("ul");
    (trail || []).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
    details.appendChild(list);
    return details;
  }

  function fieldFileUpload(dataKey, labelText) {
    const wrap = document.createElement("div");
    wrap.className = "plot-upload";

    const inputWrap = document.createElement("div");
    const inputLabel = document.createElement("p");
    inputLabel.innerHTML = `<b>Upload ${labelText.toLowerCase()} (Optional)</b>`;
    inputWrap.appendChild(inputLabel);
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.setAttribute("aria-label", `Upload ${labelText.toLowerCase()}`);
    inputWrap.appendChild(fileInput);

    const previewWrap = document.createElement("div");
    const previewLabel = document.createElement("p");
    previewLabel.innerHTML = `<b>Uploaded ${labelText.toLowerCase()}:</b>`;
    const nameSpan = document.createElement("span");
    const img = document.createElement("img");
    img.className = "plot-preview-img";
    img.alt = `${labelText} preview`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove Plot";
    removeBtn.setAttribute("aria-label", `Remove ${labelText.toLowerCase()}`);
    removeBtn.className = "plot-remove-btn";
    previewWrap.appendChild(previewLabel);
    previewWrap.appendChild(nameSpan);
    previewWrap.appendChild(document.createElement("br"));
    previewWrap.appendChild(img);
    previewWrap.appendChild(document.createElement("br"));
    previewWrap.appendChild(removeBtn);

    function refresh() {
      const data = state.answers[dataKey];
      if (data && data.dataUrl) {
        inputWrap.hidden = true;
        previewWrap.hidden = false;
        nameSpan.textContent = data.name;
        img.src = data.dataUrl;
      } else {
        inputWrap.hidden = false;
        previewWrap.hidden = true;
      }
    }

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      // The input's accept="image/*" is only a hint for the OS file picker —
      // it doesn't stop a non-image file arriving via drag-and-drop, "all
      // files" in the picker, or any other route, and without this check
      // the file would silently get base64-encoded and stored as if it were
      // a valid plot image (broken preview, likely broken exports too).
      if (!file.type.startsWith("image/")) {
        alert(`"${file.name}" doesn't look like an image (detected type: ${file.type || "unknown"}). Please choose an image file (PNG, JPG, etc.) for the plot.`);
        fileInput.value = "";
        return;
      }
      // Not a hard limit — large images still work — but they bloat the
      // save file and slow the app down, so flag it rather than stay silent.
      if (file.size > MAX_PLOT_FILE_BYTES) {
        alert(`That image is ${(file.size / (1024 * 1024)).toFixed(1)}MB, which is larger than the recommended maximum of ${MAX_PLOT_FILE_BYTES / (1024 * 1024)}MB. It will still be uploaded, but consider using a smaller/compressed image if the app feels slow afterward.`);
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.answers[dataKey] = { name: file.name, dataUrl: reader.result };
        scheduleAutosave();
        updateCurrentStepperPill();
        refresh();
      };
      reader.readAsDataURL(file);
    });

    removeBtn.addEventListener("click", () => {
      delete state.answers[dataKey];
      fileInput.value = "";
      scheduleAutosave();
      updateCurrentStepperPill();
      refresh();
    });

    refresh();
    wrap.appendChild(inputWrap);
    wrap.appendChild(previewWrap);
    return wrap;
  }

  function renderStep4(page) {
    const i = page.maIndex;
    const flags = applyStep4Cascade(i);

    const div = document.createElement("div");
    div.appendChild(stepBanner(`Step 4: Assess risk of bias due to missing evidence in meta-analysis ${i}`));

    const dependencyNote = document.createElement("p");
    dependencyNote.className = "field-hint";
    dependencyNote.textContent = "Q4.1, Q4.3, and Q4.5 auto-fill from Steps 2 and 3. Complete those first for accurate results.";
    div.appendChild(dependencyNote);

    div.appendChild(step4SectionLabel("Details of the meta-analysis being assessed for risk of bias"));
    div.appendChild(step4DetailRow("Specify the meta-analysis", fieldTextareaPlain(`${i}_title`, 1), true));
    div.appendChild(step4DetailRow("Specify the synthesized result (e.g. estimate and 95% CI)", fieldTextareaPlain(`${i}_result`, 1), true));
    div.appendChild(step4DetailRow("Specify the number of included studies", fieldNumberInput(`${i}_ma_n_study`, 0)));
    div.appendChild(step4DetailRow("Specify the number of included participants", fieldNumberInput(`${i}_ma_ss`, 0)));

    div.appendChild(document.createElement("hr"));
    div.appendChild(step4SectionLabel("The following questions relate to the within-study assessment of non-reporting bias (‘known unknowns’)"));

    div.appendChild(step3Question(
      "Q4.1. Of the studies identified, was there any for which no result was available for inclusion in the meta-analysis, likely because of the P value, magnitude or direction of the result generated (refer to Step 2)?",
      "Answer ‘Yes’ if any of the studies in the Results Matrix were marked with an ‘X’ for this particular meta-analysis.",
      `${i}_q4_1`, Q4_YN_CHOICES, true, false,
      "Auto-filled from Step 2's results for this meta-analysis."
    ));
    div.appendChild(step3Question(
      "Q4.2: Is it likely that there would be a notable change to the synthesized effect estimate if the omitted results had been included?",
      "Answer ‘Yes / Probably yes’ if the amount of missing information is non-trivial and, if known, the direction of effect in omitted studies differs from the direction of effect for the meta-analysis. Answer ‘No / Probably no’ if the amount of missing information is trivial. Only answer ‘No information’ if the sample size of any of the studies missing from the meta-analysis was unclear.",
      `${i}_q4_2`, Q4_YPN_NI_CHOICES, !flags.q4_2Enabled, true
    ));
    div.appendChild(step3Question(
      "Q4.3: Of the studies identified, was there any for which it was unclear whether an eligible result was generated (refer to Step 2)?",
      "Answer ‘Yes’ if any of the studies in the Results Matrix were marked with a ‘?’ for this particular meta-analysis.",
      `${i}_q4_3`, Q4_YN_CHOICES, true, false,
      "Auto-filled from Step 2's results for this meta-analysis."
    ));
    div.appendChild(step3Question(
      "Q4.4: Is it likely that there would be a notable change to the synthesized effect estimate if the potentially omitted results had been included?",
      "Answer ‘Yes / Probably yes’ if the amount of potentially missing information is non-trivial, or ‘No / Probably no’ if trivial. Only answer ‘No information’ if the sample size of any of the studies potentially missing from the meta-analysis was unclear.",
      `${i}_q4_4`, Q4_YPN_NI_CHOICES, !flags.q4_4Enabled, true
    ));

    div.appendChild(document.createElement("hr"));
    div.appendChild(step4SectionLabel("The following questions relate to the across-study assessment of non-reporting bias (‘unknown unknowns’)"));

    div.appendChild(step3Question(
      "Q4.5: Do circumstances indicate potential for some eligible studies not being identified because of the P value, magnitude or direction of the results generated (refer to Step 3)?",
      "Answer ‘Yes’ if the checkbox in Step 3 was checked.",
      `${i}_q4_5`, Q4_YN_CHOICES, true, false,
      "Auto-filled from Step 3's overall conclusion."
    ));
    div.appendChild(step3Question(
      "Q4.6: Is it likely that studies not identified had results that were eligible for inclusion in the meta-analysis?",
      "Answer ‘Yes / Probably yes’ if eligible results are likely to have been generated in the potentially missing studies. Answer ‘No / Probably no’ if eligible results are unlikely to have been generated in the potentially missing studies.",
      `${i}_q4_6`, Q4_YPN_CHOICES, !flags.q4_6Enabled, true
    ));
    div.appendChild(step3Question(
      "Q4.7: Does the pattern of observed study results suggest that the meta-analysis is likely to be missing results that were systematically different (in terms of P value, magnitude or direction) from those observed?",
      "Answer ‘Yes / Probably yes’ if there is a tendency for small-study effects likely caused by non-reporting biases. Answer ‘No / Probably no’ if there is no evidence of small-study effects, or another cause is more likely. Answer ‘Not applicable’ if results are available for a very small number of studies.",
      `${i}_q4_7`, Q4_YPN_CHOICES, !flags.q4_7Enabled, true
    ));

    div.appendChild(document.createElement("hr"));
    div.appendChild(step4SectionLabel("Consider the likely effect of missing studies on the result of the meta-analysis"));
    div.appendChild(step3Question(
      "Q4.8: Did sensitivity analyses suggest that the synthesized result was biased due to missing results?",
      "Answer ‘Yes / Probably yes’ if appropriate sensitivity analyses suggest the synthesized result would change notably under plausible assumptions about the missing results. Answer ‘No / Probably no’ if no sensitivity analyses were attempted, or the result was stable across analyses.",
      `${i}_q4_8`, Q4_YPN_CHOICES, !flags.q4_8Enabled, true
    ));

    div.appendChild(document.createElement("hr"));
    div.appendChild(step4SectionLabel("Suggested risk of bias judgement"));
    div.appendChild(fieldSelectPlain(`${i}_rob_suggested`, ROB_CHOICES, { disabled: true, decisionColor: true, ariaLabel: "Suggested risk of bias judgement" }));
    div.appendChild(robReasoningDetails(flags.robReasoning));

    div.appendChild(step4SectionLabel("Final risk of bias judgement"));
    div.appendChild(fieldSelectPlain(`${i}_rob_final`, ROB_CHOICES, { decisionColor: true, ariaLabel: "Final risk of bias judgement" }));

    div.appendChild(step4SectionLabel("What is the predicted direction of bias for this meta-analysis? (Optional)", false));
    div.appendChild(fieldSelectPlain(`${i}_rob_dir`, ROB_DIR_CHOICES, { ariaLabel: "Predicted direction of bias for this meta-analysis" }));

    div.appendChild(step4SectionLabel("Provide any relevant information to support judgement"));
    div.appendChild(fieldTextareaPlain(`${i}_rob_rm`, 4, "Provide any relevant information to support judgement"));

    div.appendChild(fieldFileUpload(`${i}_forest_plot_data`, "Forest plot"));
    div.appendChild(fieldFileUpload(`${i}_funnel_plot_data`, "Funnel plot"));

    return div;
  }

  function escapeHtml(str) {
    const holder = document.createElement("div");
    holder.textContent = String(str);
    return holder.innerHTML;
  }

  // Mirrors the R app's ss formatting: "0,000 participants" with a thousands separator.
  function formatStudiesParticipants(nStudy, ss) {
    const studiesText = !isAnswerEmpty(nStudy) ? `${nStudy} studies` : "";
    let participantsText = "";
    if (!isAnswerEmpty(ss)) {
      const ssNum = Number(ss);
      const formatted = Number.isFinite(ssNum) ? ssNum.toLocaleString("en-US") : ss;
      participantsText = ` (${formatted} participants)`;
    }
    const combined = `${studiesText}${participantsText}`;
    return combined === "" ? "-" : combined;
  }

  // Every risk-of-bias judgement color, on-screen or exported, traces back to
  // DECISION_COLORS — same category-per-value mapping applyDecisionColor()
  // uses for the dropdowns, so the Summary table/exports ("output") always
  // match the user-judgement dropdown ("active") rather than drifting into a
  // fourth ad hoc palette.
  const ROB_JUDGEMENT_CATEGORY = { Low: "teal", "Some concerns": "amber", High: "peach" };

  function robJudgementHex(value, muted) {
    const category = ROB_JUDGEMENT_CATEGORY[value];
    if (!category) return undefined;
    return DECISION_COLORS[category][muted ? "muted" : "active"].replace("#", "");
  }

  const ROB_ROW_COLORS = {
    Low: DECISION_COLORS.teal.active,
    "Some concerns": DECISION_COLORS.amber.active,
    High: DECISION_COLORS.peach.active,
  };

  function buildSummaryRows() {
    const n_ma = Number(state.answers.n_ma) || 1;
    const rows = [];
    for (let i = 1; i <= n_ma; i++) {
      const title = state.answers[`${i}_title`];
      const result = state.answers[`${i}_result`];
      const nStudy = state.answers[`${i}_ma_n_study`];
      const ss = state.answers[`${i}_ma_ss`];
      const robFinal = state.answers[`${i}_rob_final`];
      const robDir = state.answers[`${i}_rob_dir`];
      rows.push({
        ma: String(i),
        detail: isAnswerEmpty(title) ? "-" : title,
        result: isAnswerEmpty(result) ? "-" : result,
        studiesParticipants: formatStudiesParticipants(nStudy, ss),
        robFinal: isAnswerEmpty(robFinal) ? "-" : robFinal,
        robDir: isAnswerEmpty(robDir) ? "-" : robDir,
      });
    }
    return rows;
  }

  // ARGB (8-hex, ExcelJS) and plain 6-hex (docx shading) variants of the
  // same colors used on-screen (ROB_ROW_COLORS), since each library wants
  // the color in a different format.
  const ROB_ROW_FILL_HEX = {
    Low: robJudgementHex("Low"),
    "Some concerns": robJudgementHex("Some concerns"),
    High: robJudgementHex("High"),
  };
  const ROB_ROW_FILL_ARGB = {
    Low: "FF" + ROB_ROW_FILL_HEX.Low,
    "Some concerns": "FF" + ROB_ROW_FILL_HEX["Some concerns"],
    High: "FF" + ROB_ROW_FILL_HEX.High,
  };
  const SUMMARY_HEADERS = ["MA", "Detail", "Result", "No. included studies & participants", "Risk of bias", "Predicted direction of bias"];

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ExcelJS/docx/html2canvas (~2.2MB combined) are only used by the four
  // export functions below, reachable only from the last page (Summary) -
  // loading them isn't worth slowing down every page view for. Their source
  // still ships inside the single built HTML file (see src/index.html's
  // <script type="text/plain"> placeholders, filled in by build.js), so
  // offline/standalone use is unaffected; this just defers *evaluating*
  // that text until the first export that actually needs it, caching the
  // in-flight promise so a second export click while the first is still
  // loading doesn't kick off a duplicate load.
  const vendorLibLoadPromises = {};
  function loadVendorLib(placeholderId, globalName) {
    if (window[globalName]) return Promise.resolve();
    if (vendorLibLoadPromises[placeholderId]) return vendorLibLoadPromises[placeholderId];
    vendorLibLoadPromises[placeholderId] = new Promise((resolve, reject) => {
      const holder = document.getElementById(placeholderId);
      if (!holder) { reject(new Error(`Missing library placeholder #${placeholderId}`)); return; }
      const script = document.createElement("script");
      if (holder.textContent.trim()) {
        // Built single-file app: the library source is inlined as text.
        script.textContent = holder.textContent;
        document.head.appendChild(script);
        resolve();
      } else if (holder.dataset.src) {
        // Running unbuilt straight from src/ during development.
        script.src = holder.dataset.src;
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => reject(new Error(`Failed to load ${holder.dataset.src}`)));
        document.head.appendChild(script);
      } else {
        reject(new Error(`Library placeholder #${placeholderId} has no content or data-src`));
      }
    });
    return vendorLibLoadPromises[placeholderId];
  }
  function loadExceljs() { return loadVendorLib("lib-exceljs", "ExcelJS"); }
  function loadDocx() { return loadVendorLib("lib-docx", "docx"); }
  function loadHtml2canvas() { return loadVendorLib("lib-html2canvas", "html2canvas"); }

  const ROB_ME_FOOTER_TEXT = "This table is generated using the ROB-ME tool.";
  const ROB_ME_FOOTER_URL = "https://www.riskofbias.info/welcome/rob-me-tool";
  // Character-width column widths, sized per column's actual content rather
  // than one uniform width for every column (which wasted space on "MA" and
  // starved "Detail"/"Result").
  const SUMMARY_COL_WIDTHS = [6, 40, 32, 26, 14, 20];

  async function exportSummaryXlsx() {
    await loadExceljs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Summary");
    const title = state.answers.output_title || "";
    const thinBorder = { style: "thin" };
    const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

    // Fixed subtitle + the reviewer's custom title, both merged/centered —
    // matches the R app's two-row header (title1 fixed, title2 custom).
    sheet.mergeCells(1, 1, 1, SUMMARY_HEADERS.length);
    const fixedTitleCell = sheet.getCell(1, 1);
    fixedTitleCell.value = "Risk of Bias due to Missing Evidence";
    fixedTitleCell.font = { name: "Arial", bold: true, size: 14 };
    fixedTitleCell.alignment = { horizontal: "center" };

    sheet.mergeCells(2, 1, 2, SUMMARY_HEADERS.length);
    const titleCell = sheet.getCell(2, 1);
    titleCell.value = title;
    titleCell.font = { name: "Arial", bold: true, size: 12 };
    titleCell.alignment = { horizontal: "center" };

    let rowIndex = 4;
    const headerRow = sheet.getRow(rowIndex);
    SUMMARY_HEADERS.forEach((h, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { name: "Arial", bold: true };
      cell.border = borders;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBF3FB" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    rowIndex++;

    buildSummaryRows().forEach((row) => {
      const excelRow = sheet.getRow(rowIndex);
      const fill = ROB_ROW_FILL_ARGB[row.robFinal];
      [row.ma, row.detail, row.result, row.studiesParticipants, row.robFinal, row.robDir].forEach((v, idx) => {
        const cell = excelRow.getCell(idx + 1);
        cell.value = v;
        cell.font = { name: "Arial" };
        cell.border = borders;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
      rowIndex++;
    });

    const footerRow = sheet.getRow(rowIndex + 1);
    const footerCell = footerRow.getCell(1);
    footerCell.value = { text: ROB_ME_FOOTER_TEXT, hyperlink: ROB_ME_FOOTER_URL };
    footerCell.font = { name: "Arial", color: { argb: "FF0563C1" }, underline: true };

    const versionCell = sheet.getRow(rowIndex + 2).getCell(1);
    versionCell.value = APP_VERSION;
    versionCell.font = { name: "Arial", size: 8, color: { argb: "FF888888" } };

    sheet.columns.forEach((col, idx) => { col.width = SUMMARY_COL_WIDTHS[idx]; });

    // Fixes a real bug: without this, printing/exporting to PDF splits the
    // table across multiple pages (and even cuts the merged title in half).
    sheet.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "rob-me_summary.xlsx"
    );
  }

  // Percentage widths tailored per column (was a flat 1/6 split for every
  // column, wasting space on "MA" and starving "Detail"/"Result").
  const SUMMARY_COL_PERCENT = [6, 24, 22, 20, 12, 16];

  function robMeFooterParagraph(opts) {
    const { Paragraph, TextRun, ExternalHyperlink } = docx;
    return new Paragraph({
      children: [
        new TextRun({ text: "This table is generated using the " }),
        new ExternalHyperlink({
          link: ROB_ME_FOOTER_URL,
          children: [new TextRun({ text: "ROB-ME tool.", style: "Hyperlink" })],
        }),
        new TextRun({ text: ` (${APP_VERSION})`, size: 16, color: "888888" }),
        ...((opts && opts.trailingRuns) || []),
      ],
      tabStops: (opts && opts.tabStops) || undefined,
    });
  }

  // Standardizes every exported docx on Arial, matching the xlsx/png exports.
  const DOCX_DEFAULT_STYLES = { default: { document: { run: { font: "Arial" } } } };

  // Shared TableCell wrapper so every docx table in the exports gets the same
  // vertical centering + top/bottom padding (~2px, 30 dxa) without repeating
  // those options at every call site.
  function docxCell(opts) {
    return new docx.TableCell({
      verticalAlign: docx.VerticalAlign.CENTER,
      margins: { top: 30, bottom: 30 },
      ...opts,
    });
  }

  async function exportSummaryDocx() {
    await loadDocx();
    const { Document, Packer, Table, TableRow, Paragraph, TextRun, WidthType, AlignmentType, PageOrientation, Header, Footer } = docx;

    const title = state.answers.output_title || "";
    const rows = buildSummaryRows();

    const headerRow = new TableRow({
      children: SUMMARY_HEADERS.map((h, idx) => docxCell({
        width: { size: SUMMARY_COL_PERCENT[idx], type: WidthType.PERCENTAGE },
        shading: { fill: "EBF3FB" },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
      })),
    });

    const bodyRows = rows.map((row) => {
      const fill = ROB_ROW_FILL_HEX[row.robFinal];
      const cellValues = [row.ma, row.detail, row.result, row.studiesParticipants, row.robFinal, row.robDir];
      return new TableRow({
        children: cellValues.map((v, idx) => docxCell({
          width: { size: SUMMARY_COL_PERCENT[idx], type: WidthType.PERCENTAGE },
          shading: fill ? { fill } : undefined,
          children: [new Paragraph(String(v))],
        })),
      });
    });

    const table = new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    });

    const pageHeader = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Risk of Bias due to Missing Evidence", bold: true, size: 28 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: title, bold: true, size: 24 })],
        }),
      ],
    });

    const document_ = new Document({
      styles: DOCX_DEFAULT_STYLES,
      sections: [{
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
        headers: { default: pageHeader },
        footers: { default: new Footer({ children: [robMeFooterParagraph()] }) },
        children: [table],
      }],
    });

    const blob = await Packer.toBlob(document_);
    downloadBlob(blob, "rob-me_summary.docx");
  }

  async function exportSummaryPng() {
    await loadHtml2canvas();
    const title = state.answers.output_title || "";
    const rows = buildSummaryRows();

    // Render a standalone, off-screen copy (not the live form) so the image
    // shows clean text/table rather than editable form widgets.
    const capture = document.createElement("div");
    capture.style.cssText = "position:absolute;left:-9999px;top:0;background:#fff;padding:20px;border:1px solid #ccc;font-family:Arial,sans-serif;";
    const fixedSubtitle = document.createElement("h3");
    fixedSubtitle.textContent = "Risk of Bias due to Missing Evidence";
    fixedSubtitle.style.cssText = "text-align:center;margin:0 0 4px;";
    capture.appendChild(fixedSubtitle);
    if (title) {
      const h = document.createElement("h2");
      h.textContent = title;
      h.style.cssText = "text-align:center;margin:0 0 16px;";
      capture.appendChild(h);
    }
    const table = document.createElement("table");
    table.className = "summary-table";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>${SUMMARY_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.style.backgroundColor = ROB_ROW_COLORS[row.robFinal] || "#FFFFFF";
      tr.innerHTML = [row.ma, row.detail, row.result, row.studiesParticipants, row.robFinal, row.robDir]
        .map((v) => `<td>${escapeHtml(v)}</td>`).join("");
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    capture.appendChild(table);

    const footerCaption = document.createElement("p");
    footerCaption.textContent = `${ROB_ME_FOOTER_TEXT} (www.riskofbias.info/welcome/rob-me-tool). ${APP_VERSION}`;
    footerCaption.style.cssText = "font-size:0.8rem;color:#333;margin-top:12px;text-align:left;";
    capture.appendChild(footerCaption);

    document.body.appendChild(capture);

    try {
      const canvas = await html2canvas(capture, { backgroundColor: "#ffffff", scale: 2 });
      await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          downloadBlob(blob, "rob-me_summary.png");
          resolve();
        });
      });
    } finally {
      document.body.removeChild(capture);
    }
  }

  function getValExport(key) {
    const v = state.answers[key];
    return isAnswerEmpty(v) ? "N/A" : String(v);
  }

  const QA_TABLE_COL_PERCENT = [40, 60];

  function qaTable(rows) {
    return new docx.Table({
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      rows: rows.map(([q, a]) => new docx.TableRow({
        children: [
          docxCell({ width: { size: QA_TABLE_COL_PERCENT[0], type: docx.WidthType.PERCENTAGE }, children: [new docx.Paragraph(q)] }),
          docxCell({ width: { size: QA_TABLE_COL_PERCENT[1], type: docx.WidthType.PERCENTAGE }, children: [new docx.Paragraph(a)] }),
        ],
      })),
    });
  }

  // A no-header, 2-column table (label | text) - used for the Step 2 remarks
  // block and any other "list of MA -> free text" section.
  function labeledTextTable(rows) {
    return new docx.Table({
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      rows: rows.map(([label, text]) => new docx.TableRow({
        children: [
          docxCell({ width: { size: QA_TABLE_COL_PERCENT[0], type: docx.WidthType.PERCENTAGE }, children: [new docx.Paragraph(label)] }),
          docxCell({ width: { size: QA_TABLE_COL_PERCENT[1], type: docx.WidthType.PERCENTAGE }, children: [new docx.Paragraph(text)] }),
        ],
      })),
    });
  }

  function sectionHeading(stepText, mainText) {
    const runs = [new docx.TextRun({ text: stepText, bold: true, underline: {}, size: 28 })];
    if (mainText) runs.push(new docx.TextRun({ text: mainText, bold: true, size: 28 }));
    return new docx.Paragraph({ children: runs, spacing: { before: 200, after: 200 } });
  }

  async function dataUrlToUint8Array(dataUrl) {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  function getImageNaturalSize(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = dataUrl;
    });
  }

  function docxImageTypeFromDataUrl(dataUrl) {
    const match = /^data:image\/([a-zA-Z0-9+.-]+);/.exec(dataUrl);
    const sub = (match ? match[1] : "png").toLowerCase();
    if (sub === "jpeg") return "jpg";
    return ["png", "jpg", "gif", "bmp"].includes(sub) ? sub : "png";
  }

  // Mirrors the R app's "Download all answers as .docx" — a full assessment
  // document covering Initial Setup and every step, not just the summary table.
  async function exportAllAnswersDocx() {
    await loadDocx();
    const n_ma = Number(state.answers.n_ma) || 0;
    const n_studies = Number(state.answers.n_studies) || 0;
    const children = [];

    children.push(new docx.Paragraph({
      children: [new docx.TextRun({ text: "Risk of Bias due to Missing Evidence - full assessment", bold: true, size: 30 })],
      spacing: { after: 200 },
    }));

    children.push(sectionHeading("Initial setup"));
    children.push(qaTable([["How many meta-analyses are there?", getValExport("n_ma")]]));
    children.push(new docx.Paragraph(""));

    if (n_ma > 0) {
      children.push(sectionHeading("Step 1.", " Select and define meta-analyses that will be assessed for risk of bias due to missing evidence"));
      for (let i = 1; i <= n_ma; i++) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Meta-analysis ${i}`, bold: true })] }));
        children.push(qaTable([
          ["Participants", getValExport(`${i}_p`)],
          ["Intervention", getValExport(`${i}_i`)],
          ["Comparator", getValExport(`${i}_c`)],
          ["Outcome", getValExport(`${i}_o`)],
          ["Eligible study designs", getValExport(`${i}_ds`)],
          ["Eligible outcome definitions", getValExport(`${i}_oc`)],
          ["Eligible methods of analysis", getValExport(`${i}_met`)],
        ]));
        children.push(new docx.Paragraph(""));
      }
    }

    if (n_studies > 0 && n_ma > 0) {
      children.push(sectionHeading("Step 2.", " Determine which studies meeting the inclusion criteria for the meta-analyses have missing results"));
      const headerCells = ["Study ID", "Source(s) used", "No. participants"]
        .concat(Array.from({ length: n_ma }, (_, x) => `Results MA ${x + 1}`));
      const headerRow = new docx.TableRow({
        children: headerCells.map((h, idx) => docxCell({
          shading: { fill: "EBF3FB" },
          children: [new docx.Paragraph({
            alignment: idx === 0 ? undefined : docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ text: h, bold: true })],
          })],
        })),
      });
      const bodyRows = [];
      for (let y = 1; y <= n_studies; y++) {
        const cells = [getValExport(`${y}_id`), getValExport(`${y}_source`), getValExport(`${y}_ss`)];
        for (let x = 1; x <= n_ma; x++) cells.push(getValExport(`${x}_${y}_results`));
        bodyRows.push(new docx.TableRow({
          children: cells.map((v, idx) => docxCell({
            children: [new docx.Paragraph({
              alignment: idx === 0 ? undefined : docx.AlignmentType.CENTER,
              children: [new docx.TextRun(v)],
            })],
          })),
        }));
      }
      children.push(new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }));
      children.push(new docx.Paragraph(""));
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: "Remarks", bold: true })], spacing: { before: 100, after: 100 } }));
      const remarksRows = [];
      for (let i = 1; i <= n_ma; i++) remarksRows.push([`MA${i}`, getValExport(`${i}_step2_ma_rm`)]);
      children.push(labeledTextTable(remarksRows));
      children.push(new docx.Paragraph(""));
    }

    children.push(sectionHeading("Step 3.", " Consider circumstances indicating potential for missing studies across the review"));
    children.push(qaTable([
      ["Q3.1. Were prospectively registered studies or studies identified for a prospective meta-analysis the only type of study eligible for inclusion in the review?", getValExport("q3_1_results")],
      ["Q3.2. Would you expect information about every eligible study to be made publicly available regardless of their results?", getValExport("q3_2_results")],
      ["Q3.3. Were you likely to have found all eligible studies regardless of their results?", getValExport("q3_3_results")],
      ["Circumstances indicate potential for some eligible studies not being identified because of the P value, magnitude or direction of the results generated", getValExport("q3_overall")],
      ["Remarks", getValExport("q3_rm")],
    ]));
    children.push(new docx.Paragraph(""));

    if (n_ma > 0) {
      children.push(sectionHeading("Step 4.", " Assess risk of bias due to missing evidence in meta-analysis"));
      for (let i = 1; i <= n_ma; i++) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Meta-analysis ${i}`, bold: true })] }));

        const suggested = getValExport(`${i}_rob_suggested`);
        const finalJudgement = getValExport(`${i}_rob_final`);
        const suggestedFill = robJudgementHex(suggested, true);
        const finalFill = robJudgementHex(finalJudgement, false);

        function qaRow(q, a, opts) {
          opts = opts || {};
          const questionCell = docxCell({
            columnSpan: opts.merge ? 2 : undefined,
            width: { size: QA_TABLE_COL_PERCENT[0], type: docx.WidthType.PERCENTAGE },
            children: [new docx.Paragraph({ children: [new docx.TextRun({ text: q, bold: !!opts.bold, italics: !!opts.italic })] })],
          });
          if (opts.merge) return new docx.TableRow({ children: [questionCell] });
          const answerCell = docxCell({
            width: { size: QA_TABLE_COL_PERCENT[1], type: docx.WidthType.PERCENTAGE },
            shading: opts.fill ? { fill: opts.fill } : undefined,
            children: [new docx.Paragraph({ children: [new docx.TextRun({ text: a, bold: !!opts.bold })] })],
          });
          return new docx.TableRow({ children: [questionCell, answerCell] });
        }

        const rows = [
          qaRow("Specify the meta-analysis", getValExport(`${i}_title`)),
          qaRow("Specify the synthesized result (e.g. estimate and 95% CI)", getValExport(`${i}_result`)),
          qaRow("Specify the number of included studies", getValExport(`${i}_ma_n_study`)),
          qaRow("Specify the number of included participants", getValExport(`${i}_ma_ss`)),
          qaRow("Within-study assessment of non-reporting bias (‘known unknowns’)", "", { merge: true, bold: true, italic: true }),
          qaRow("Q4.1. Of the studies identified, was there any for which no result was available for inclusion in the meta-analysis, likely because of the P value, magnitude or direction of the result generated (refer to Step 2)?", getValExport(`${i}_q4_1`)),
          qaRow("Q4.2: Is it likely that there would be a notable change to the synthesized effect estimate if the omitted results had been included?", getValExport(`${i}_q4_2`)),
          qaRow("Q4.3: Of the studies identified, was there any for which it was unclear whether an eligible result was generated (refer to Step 2)?", getValExport(`${i}_q4_3`)),
          qaRow("Q4.4: Is it likely that there would be a notable change to the synthesized effect estimate if the potentially omitted results had been included?", getValExport(`${i}_q4_4`)),
          qaRow("Across-study assessment of non-reporting bias (‘unknown unknowns’)", "", { merge: true, bold: true, italic: true }),
          qaRow("Q4.5: Do circumstances indicate potential for some eligible studies not being identified because of the P value, magnitude or direction of the results generated (refer to Step 3)?", getValExport(`${i}_q4_5`)),
          qaRow("Q4.6: Is it likely that studies not identified had results that were eligible for inclusion in the meta-analysis?", getValExport(`${i}_q4_6`)),
          qaRow("Q4.7: Does the pattern of observed study results suggest that the meta-analysis is likely to be missing results that were systematically different (in terms of P value, magnitude or direction) from those observed?", getValExport(`${i}_q4_7`)),
          qaRow("Q4.8: Did sensitivity analyses suggest that the synthesized result was biased due to missing results?", getValExport(`${i}_q4_8`)),
          qaRow("Suggested risk of bias judgement", suggested, { bold: true, fill: suggestedFill }),
          qaRow("Final risk of bias judgement", finalJudgement, { bold: true, fill: finalFill }),
          qaRow("What is the predicted direction of bias for this meta-analysis? (Optional)", getValExport(`${i}_rob_dir`)),
          qaRow("Provide any relevant information to support judgement", getValExport(`${i}_rob_rm`)),
        ];

        children.push(new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows }));
        children.push(new docx.Paragraph(""));

        const plots = [["Forest plot", state.answers[`${i}_forest_plot_data`]], ["Funnel plot", state.answers[`${i}_funnel_plot_data`]]];
        for (const [label, data] of plots) {
          if (data && data.dataUrl) {
            const bytes = await dataUrlToUint8Array(data.dataUrl);
            const size = await getImageNaturalSize(data.dataUrl);
            const widthPx = Math.min(size.width || 600, 600);
            const heightPx = size.width ? widthPx * (size.height / size.width) : widthPx;
            children.push(new docx.Paragraph({ children: [new docx.TextRun(label)] }));
            children.push(new docx.Paragraph({
              children: [new docx.ImageRun({
                type: docxImageTypeFromDataUrl(data.dataUrl),
                data: bytes,
                transformation: { width: widthPx, height: heightPx },
              })],
            }));
            children.push(new docx.Paragraph(""));
          }
        }
      }
    }

    const pageHeader = new docx.Header({
      children: [
        new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          children: [new docx.TextRun({ text: "Risk of Bias due to Missing Evidence - full assessment", bold: true, size: 20 })],
        }),
      ],
    });

    const pageFooter = new docx.Footer({
      children: [
        robMeFooterParagraph({
          tabStops: [{ type: docx.TabStopType.RIGHT, position: docx.TabStopPosition.MAX }],
          trailingRuns: [
            new docx.TextRun("\t"),
            new docx.TextRun("Page "),
            new docx.TextRun({ children: [docx.PageNumber.CURRENT] }),
            new docx.TextRun(" of "),
            new docx.TextRun({ children: [docx.PageNumber.TOTAL_PAGES] }),
          ],
        }),
      ],
    });

    const document_ = new docx.Document({
      styles: DOCX_DEFAULT_STYLES,
      sections: [{
        headers: { default: pageHeader },
        footers: { default: pageFooter },
        children,
      }],
    });
    const blob = await docx.Packer.toBlob(document_);
    downloadBlob(blob, "rob-me_all_answers.docx");
  }

  function renderSummary() {
    const div = document.createElement("div");
    div.appendChild(stepBanner("Summary of risk-of-bias judgement"));

    // Persisted immediately (matching Step 2's n_studies default) so the
    // default title is actually saved/exported even if never edited.
    if (!state.answers.output_title) {
      state.answers.output_title = "Summary of risk of bias due to missing evidence";
    }

    const titleField = document.createElement("input");
    titleField.type = "text";
    titleField.id = "field-output_title";
    titleField.setAttribute("aria-label", "Title of table");
    titleField.className = "summary-title-input";
    titleField.value = state.answers.output_title || "";
    titleField.addEventListener("input", () => {
      state.answers.output_title = titleField.value;
      scheduleAutosave();
      updateCurrentStepperPill();
    });
    div.appendChild(titleField);

    const table = document.createElement("table");
    table.className = "summary-table";
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>MA</th><th>Detail</th><th>Result</th>
        <th>No. included studies &amp; participants</th>
        <th>Risk of bias</th><th>Predicted direction of bias</th>
      </tr>
    `;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    buildSummaryRows().forEach((row) => {
      const tr = document.createElement("tr");
      tr.style.backgroundColor = ROB_ROW_COLORS[row.robFinal] || "#FFFFFF";
      tr.innerHTML = `
        <td>${row.ma}</td><td>${escapeHtml(row.detail)}</td><td>${escapeHtml(row.result)}</td>
        <td>${escapeHtml(row.studiesParticipants)}</td><td>${escapeHtml(row.robFinal)}</td>
        <td>${escapeHtml(row.robDir)}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    div.appendChild(table);

    const exportsWrap = document.createElement("div");
    exportsWrap.className = "summary-exports";
    const exportHandlers = {
      "Download summary as .xlsx": exportSummaryXlsx,
      "Download summary as .docx": exportSummaryDocx,
      "Download summary as .png": exportSummaryPng,
      "Download all answers as .docx": exportAllAnswersDocx,
    };
    [
      "Download summary as .xlsx",
      "Download summary as .docx",
      "Download summary as .png",
      "Download all answers as .docx",
    ].forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        const handler = exportHandlers[label];
        if (!handler) {
          alert(`"${label}" isn't implemented yet. It needs to cover every step's answers (not just this summary table), so it's being built as a separate follow-up.`);
          return;
        }
        try {
          await handler();
        } catch (err) {
          alert("Export failed: " + err.message);
        }
      });
      exportsWrap.appendChild(btn);
    });
    div.appendChild(exportsWrap);

    return div;
  }

  function stepBanner(text) {
    const div = document.createElement("div");
    div.className = "step-banner";
    div.textContent = text;
    return div;
  }

  // Lets a reviewer copy PICO/eligibility fields from another meta-analysis
  // rather than retyping criteria that are often shared across MAs in the
  // same review (e.g. same population, different outcome).
  function copyPicoFields(sourceIndex, targetIndex) {
    STEP1_FIELD_SUFFIXES.forEach((suffix) => {
      state.answers[`${targetIndex}${suffix}`] = state.answers[`${sourceIndex}${suffix}`] || "";
    });
  }

  function addMetaAnalysis() {
    const newIndex = (Number(state.answers.n_ma) || 1) + 1;
    state.answers.n_ma = newIndex;
    buildPages();
    scheduleAutosave();
    // goToId() below navigates and calls render(), which rebuilds the
    // stepper anyway (pages.length just changed) — no separate call needed.
    goToId(`step1_${newIndex}`);
  }

  // Cascades exactly like Step 2's remove-study logic, but across every MA-
  // indexed field spanning Steps 1, 2, and 4 (PICO, results columns, all of
  // Step 4 including plots): shift each subsequent MA's data down one index,
  // then delete the now-duplicate last slot.
  function removeMetaAnalysis(removeIndex) {
    const n_ma = Number(state.answers.n_ma) || 1;
    if (n_ma <= 1) {
      alert("Cannot remove the last meta-analysis.");
      return;
    }
    if (!confirm(
      `Remove Meta-analysis ${removeIndex}? This permanently deletes its PICO, Step 2 results, and Step 4 answers (including any uploaded plots), and renumbers the meta-analyses after it. This cannot be undone.`
    )) {
      return;
    }

    const n_studies = Number(state.answers.n_studies) || 1;
    const maSuffixes = STEP1_FIELD_SUFFIXES.concat(STEP4_MA_FIELD_SUFFIXES, ["_step2_ma_rm"]);

    for (let i = removeIndex; i < n_ma; i++) {
      maSuffixes.forEach((suffix) => {
        const currentKey = `${i}${suffix}`;
        const nextKey = `${i + 1}${suffix}`;
        if (state.answers[nextKey] !== undefined) state.answers[currentKey] = state.answers[nextKey];
        else delete state.answers[currentKey];
      });
      for (let y = 1; y <= n_studies; y++) {
        const currentKey = `${i}_${y}_results`;
        const nextKey = `${i + 1}_${y}_results`;
        if (state.answers[nextKey] !== undefined) state.answers[currentKey] = state.answers[nextKey];
        else delete state.answers[currentKey];
      }
    }
    maSuffixes.forEach((suffix) => delete state.answers[`${n_ma}${suffix}`]);
    for (let y = 1; y <= n_studies; y++) delete state.answers[`${n_ma}_${y}_results`];

    state.answers.n_ma = n_ma - 1;
    buildPages();
    if (state.currentPageIndex >= pages.length) state.currentPageIndex = pages.length - 1;
    scheduleAutosave();
    // render() below rebuilds the stepper anyway (pages.length just changed).
    render();
  }

  function step1MaControls(currentIndex, n_ma) {
    const wrap = document.createElement("div");
    wrap.className = "step1-ma-controls";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Add another meta-analysis";
    addBtn.addEventListener("click", addMetaAnalysis);
    wrap.appendChild(addBtn);

    if (n_ma > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "step1-remove-btn";
      removeBtn.textContent = `− Remove Meta-analysis ${currentIndex}`;
      removeBtn.addEventListener("click", () => removeMetaAnalysis(currentIndex));
      wrap.appendChild(removeBtn);
    }

    return wrap;
  }

  function step1CopyControl(currentIndex, n_ma) {
    if (n_ma <= 1) return null;
    const wrap = document.createElement("div");
    wrap.className = "step1-copy";
    const label = document.createElement("label");
    label.textContent = "Copy PICO/eligibility from: ";
    label.setAttribute("for", `copy-pico-select-${currentIndex}`);
    const select = document.createElement("select");
    select.id = `copy-pico-select-${currentIndex}`;
    for (let x = 1; x <= n_ma; x++) {
      if (x === currentIndex) continue;
      const option = document.createElement("option");
      option.value = x;
      option.textContent = `Meta-analysis ${x}`;
      select.appendChild(option);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      const hasExisting = STEP1_FIELD_SUFFIXES.some(
        (suffix) => String(state.answers[`${currentIndex}${suffix}`] || "").trim() !== ""
      );
      if (hasExisting && !confirm(`This will overwrite the PICO/eligibility fields already filled in for Meta-analysis ${currentIndex}. Continue?`)) {
        return;
      }
      copyPicoFields(Number(select.value), currentIndex);
      scheduleAutosave();
      // render() below rebuilds the stepper anyway.
      render();
    });
    wrap.appendChild(label);
    wrap.appendChild(select);
    wrap.appendChild(btn);
    return wrap;
  }

  function renderStep1(page) {
    const i = page.maIndex;
    const div = document.createElement("div");
    div.appendChild(stepBanner(
      "Step 1. Select and define meta-analyses that will be assessed for risk of bias due to missing evidence"
    ));

    const heading = document.createElement("h2");
    heading.textContent = `Meta-analysis ${i}`;
    div.appendChild(heading);

    const n_ma = Number(state.answers.n_ma) || 1;
    div.appendChild(step1MaControls(i, n_ma));

    const copyControl = step1CopyControl(i, n_ma);
    if (copyControl) div.appendChild(copyControl);

    div.appendChild(document.createElement("hr"));

    const picoHeading = document.createElement("h3");
    picoHeading.textContent = "Specify the PICO for this meta-analysis";
    div.appendChild(picoHeading);

    div.appendChild(fieldTextarea(`${i}_p`, '<span class="field-label-main">Participants</span> <span class="field-example">(e.g. Patients with shoulder pain)</span>'));
    div.appendChild(fieldTextarea(`${i}_i`, '<span class="field-label-main">Intervention(s)</span> <span class="field-example">(e.g. Ibuprofen)</span>'));
    div.appendChild(fieldTextarea(`${i}_c`, '<span class="field-label-main">Comparator</span> <span class="field-example">(e.g. Placebo)</span>'));
    div.appendChild(fieldTextarea(`${i}_o`, '<span class="field-label-main">Outcome</span> <span class="field-example">(e.g. Pain intensity at short-term, 0-12 weeks)</span>'));

    div.appendChild(document.createElement("hr"));

    const eligHeading = document.createElement("h3");
    eligHeading.textContent = "Specify which study designs and results were eligible for inclusion.";
    div.appendChild(eligHeading);
    const eligHint = document.createElement("p");
    eligHint.className = "field-hint";
    eligHint.textContent = "If such information is reported elsewhere in the systematic review, either indicate the relevant section of the review or copy the information here.";
    div.appendChild(eligHint);

    div.appendChild(fieldTextarea(`${i}_ds`, '<span class="field-label-main">Eligible study designs</span> <span class="field-example">(e.g. randomised trials)</span>'));
    div.appendChild(fieldTextarea(`${i}_oc`, '<span class="field-label-main">Eligible outcome definitions</span> <span class="field-example">(e.g. measures, metrics, time points)</span>'));
    div.appendChild(fieldTextarea(`${i}_met`, '<span class="field-label-main">Eligible methods of analysis</span> <span class="field-example">(e.g. analysis populations, crude or adjusted estimates)</span>'));

    return div;
  }

  function renderSetup() {
    const div = document.createElement("div");
    div.innerHTML = `
      <h1>Initial Setup</h1>
      <div class="field">
        <label for="n_ma-input">Number of meta-analysis results to assess</label>
        <input type="number" id="n_ma-input" class="field-input-small" min="1" step="1" value="${state.answers.n_ma}">
      </div>
    `;
    div.querySelector("#n_ma-input").addEventListener("change", (e) => {
      let value = Math.max(1, Math.round(Number(e.target.value) || 1));
      if (value > MAX_N_MA) {
        alert(`${value} meta-analyses is far more than this tool supports (max ${MAX_N_MA}). Using ${MAX_N_MA} instead.`);
        value = MAX_N_MA;
      }
      e.target.value = value;
      state.answers.n_ma = value;
      buildPages();
      goToId("setup");
      scheduleAutosave();
    });
    return div;
  }

  function renderStub(page) {
    const div = document.createElement("div");
    div.className = "page-placeholder";
    div.innerHTML = `<h1>${page.label}</h1><p>Page content not yet implemented.</p>`;
    return div;
  }

  function render() {
    const page = currentPage();
    const container = document.getElementById("page-content");
    container.innerHTML = "";
    container.appendChild(renderers[page.type](page));
    renderNavChrome(page);
    renderStepper(page);
  }

  // Returns true/false once a page type's fields are known, or null for
  // page types not yet implemented (so the stepper can skip the dot rather
  // than falsely claiming "not started").
  function pageAnswered(page) {
    if (page.type === "step1") {
      return STEP1_FIELD_SUFFIXES.some(
        (suffix) => String(state.answers[`${page.maIndex}${suffix}`] || "").trim() !== ""
      );
    }
    if (page.type === "step2") {
      const n_ma = Number(state.answers.n_ma) || 1;
      const n_studies = Number(state.answers.n_studies) || 1;
      for (let y = 1; y <= n_studies; y++) {
        if (String(state.answers[`${y}_id`] || "").trim() !== "") return true;
        if (String(state.answers[`${y}_source`] || "").trim() !== "") return true;
        for (let x = 1; x <= n_ma; x++) {
          if (String(state.answers[`${x}_${y}_results`] || "").trim() !== "") return true;
        }
      }
      return false;
    }
    if (page.type === "step3") {
      return ["q3_1_results", "q3_2_results", "q3_3_results", "q3_overall", "q3_rm"].some(
        (key) => String(state.answers[key] || "").trim() !== ""
      );
    }
    if (page.type === "step4") {
      const i = page.maIndex;
      const keys = [
        `${i}_title`, `${i}_result`, `${i}_ma_n_study`, `${i}_ma_ss`,
        `${i}_q4_2`, `${i}_q4_4`, `${i}_q4_6`, `${i}_q4_7`, `${i}_q4_8`,
        `${i}_rob_final`, `${i}_rob_dir`, `${i}_rob_rm`,
      ];
      return keys.some((key) => String(state.answers[key] || "").trim() !== "");
    }
    if (page.type === "summary") {
      return String(state.answers.output_title || "").trim() !== "";
    }
    return null;
  }

  function stepperLabel(page) {
    switch (page.type) {
      case "landing": return "Welcome";
      case "instructions": return "Instructions";
      case "about": return "About";
      case "setup": return "Setup";
      case "step1": return `S1·${page.maIndex}`;
      case "step2": return "S2";
      case "step3": return "S3";
      case "step4": return `S4·${page.maIndex}`;
      case "summary": return "Summary";
      default: return page.label;
    }
  }

  function renderStepper(currentPageObj) {
    const nav = document.getElementById("stepper");
    if (!nav) return;
    nav.innerHTML = "";
    stepperPillsById = {};
    pages.forEach((p) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "stepper-pill";
      pill.title = p.label;
      if (p.id === currentPageObj.id) pill.classList.add("active");
      if (pageAnswered(p) === true) pill.classList.add("answered");
      pill.textContent = stepperLabel(p);
      pill.addEventListener("click", () => goToId(p.id));
      nav.appendChild(pill);
      stepperPillsById[p.id] = pill;
    });
  }

  // Cheap alternative to renderStepper() for plain field edits (typing in a
  // textarea, picking a select value, etc.): a keystroke on the current page
  // can only change *that page's* own answered-status (pageAnswered() never
  // reads another page's fields), so there's no need to wipe/rebuild every
  // pill and re-run pageAnswered() for the whole `pages` list — including
  // Step 2's check, which scans the full n_ma x n_studies results matrix —
  // on every single keystroke anywhere in the app. Only used when the page
  // list/current page itself hasn't changed; anything that changes those
  // (navigation, add/remove study or MA, Step 3 cascades) still goes through
  // the full render() -> renderStepper() path, which rebuilds the pill map
  // this function reads from.
  function updateCurrentStepperPill() {
    const page = currentPage();
    const pill = stepperPillsById[page.id];
    if (!pill) return;
    pill.classList.toggle("answered", pageAnswered(page) === true);
  }

  function renderNavChrome(page) {
    const label = `Page ${state.currentPageIndex + 1} of ${pages.length}: ${page.label}`;
    document.getElementById("page-label-bottom").textContent = label;
    const prevBtn = document.querySelector('[data-action="prev"]');
    const nextBtn = document.querySelector('[data-action="next"]');
    if (prevBtn) prevBtn.disabled = state.currentPageIndex <= 0;
    if (nextBtn) nextBtn.disabled = state.currentPageIndex >= pages.length - 1;
  }

  // ---- CSV save/resume ----
  // The user-facing Save/Resume format: a "varname,value" CSV (editable in
  // any spreadsheet app, pasteable from other software), plus separate image
  // downloads for any forest/funnel plots (CSV cells can't hold binary data —
  // see docs/ROB-ME_style_guide.md and the user guide for why). Internal
  // localStorage autosave stays JSON regardless — it never leaves the browser
  // so there's no editability requirement to satisfy there.

  // Minimal RFC4180-style parser: handles quoted fields containing commas,
  // newlines, and escaped quotes, since answer text (PICO, remarks) can
  // contain any of those — a naive split(",") would silently corrupt data.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter((r) => !(r.length === 1 && r[0] === ""));
  }

  // Direct port of the R app's get_valid_options() — the allowed dropdown
  // values per field pattern, used to validate every cell on CSV import.
  function csvFieldChoices(varname) {
    if (varname === "q3_1_results") return ["", "Yes", "No"];
    if (varname === "q3_2_results" || varname === "q3_3_results") {
      return ["", "Not applicable", "Yes", "Probably yes", "Probably no", "No"];
    }
    if (varname === "q3_overall") return ["", "Yes", "No"];
    if (/_results$/.test(varname)) return ["", "✓", "~", "?", "X"];
    if (/_q4_1$/.test(varname) || /_q4_3$/.test(varname) || /_q4_5$/.test(varname)) return ["", "Yes", "No"];
    if (/_q4_2$/.test(varname) || /_q4_4$/.test(varname)) {
      return ["", "Yes", "Probably yes", "Probably no", "No", "No information"];
    }
    if (/_q4_6$/.test(varname) || /_q4_7$/.test(varname) || /_q4_8$/.test(varname)) {
      return ["", "Yes", "Probably yes", "Probably no", "No"];
    }
    if (/_rob_suggested$/.test(varname) || /_rob_final$/.test(varname)) return ["", "Low", "Some concerns", "High"];
    if (/_rob_dir$/.test(varname)) {
      return ["", "Favours experimental", "Favours comparator", "Towards null", "Away from null", "Unpredictable"];
    }
    return null;
  }

  function isNumericField(varname) {
    return varname === "n_ma" || varname === "n_studies" || /_ss$/.test(varname);
  }

  function isImageField(varname) {
    return /_forest_plot_data$|_funnel_plot_data$/.test(varname);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function exportProgressCsv() {
    const n_ma = Number(state.answers.n_ma) || 1;
    const n_studies = Number(state.answers.n_studies) || 1;
    const varnames = getAllVarnames(n_ma, n_studies);
    // Metadata, not assessment data — deliberately outside getAllVarnames()
    // so it doesn't become part of the app's actual data schema. Older app
    // versions importing a file with this row just see it as an
    // unrecognized field and ignore it; importProgressCsv here special-cases
    // it to skip that "unrecognized" note since it's expected metadata.
    const rows = [["varname", "value"], ["robme_version", APP_VERSION]];
    const imageDownloads = [];

    varnames.forEach((varname) => {
      if (isImageField(varname)) {
        const data = state.answers[varname];
        if (data && data.dataUrl) {
          const kind = varname.includes("forest") ? "forest" : "funnel";
          const maIndex = varname.split("_")[0];
          const extMatch = /^data:image\/(\w+);/.exec(data.dataUrl);
          const ext = extMatch ? extMatch[1].replace("jpeg", "jpg") : "png";
          const filename = `rob-me_ma${maIndex}_${kind}_plot.${ext}`;
          imageDownloads.push({ filename, dataUrl: data.dataUrl });
          rows.push([varname, filename]);
        } else {
          rows.push([varname, ""]);
        }
        return;
      }
      const value = state.answers[varname];
      rows.push([varname, value === undefined || value === null ? "" : value]);
    });

    // UTF-8 BOM so Excel opens the ✓/~/? symbols correctly instead of mangling them.
    downloadBlob(
      new Blob(["﻿" + encodeCsv(rows)], { type: "text/csv;charset=utf-8" }),
      "rob-me_progress.csv"
    );

    Promise.all(imageDownloads.map(({ filename, dataUrl }) =>
      fetch(dataUrl).then((r) => r.blob()).then((blob) => downloadBlob(blob, filename))
    )).then(() => {
      if (imageDownloads.length) {
        alert(
          `Also downloaded ${imageDownloads.length} plot image file(s):\n\n${imageDownloads.map((d) => d.filename).join("\n")}\n\nKeep these together with rob-me_progress.csv. You'll need to provide both to resume with your plots intact.`
        );
      }
    });
  }

  // A blank rob-me_progress.csv, generated the same way a fresh install's
  // "Save Progress" would, so the field list can never drift from
  // getAllVarnames() the way a hand-maintained static file could.
  function downloadTemplateCsv() {
    const blankAnswers = { n_ma: 1 };
    const varnames = getAllVarnames(1, 1);
    const rows = [["varname", "value"], ["robme_version", APP_VERSION]];
    varnames.forEach((varname) => {
      const value = blankAnswers[varname];
      rows.push([varname, value === undefined || value === null ? "" : value]);
    });
    downloadBlob(
      new Blob(["﻿" + encodeCsv(rows)], { type: "text/csv;charset=utf-8" }),
      "rob-me_template_progress.csv"
    );
  }

  async function importProgressCsv(csvFile, imageAssignments) {
    const text = await csvFile.text();
    const rows = parseCsv(text);
    if (!rows.length || rows[0][0] !== "varname" || rows[0][1] !== "value") {
      alert("Please select a valid ROB-ME progress CSV file. Its first row should read \"varname,value\" and must not be altered. If you do not have one, a blank template can be downloaded from the Instructions page (\"Download a blank template save file\").");
      return false;
    }

    const raw = {};
    rows.slice(1).forEach(([varname, value]) => {
      if (!varname) return;
      let v = value === undefined ? "" : value;
      // Undo the formula-injection guard csvEscapeCell adds on export (a
      // leading ' before =/+/-/@) so a value round-tripped through this
      // app's own Save/Resume comes back exactly as typed, not with a
      // stray leading apostrophe.
      if (v[0] === "'" && FORMULA_GUARD_RE.test(v.slice(1))) v = v.slice(1);
      raw[varname] = v;
    });

    const rawNma = Number(raw.n_ma);
    if (Number.isFinite(rawNma) && rawNma > MAX_N_MA) {
      alert(`This file specifies ${raw.n_ma} meta-analyses, which exceeds the maximum this tool supports (${MAX_N_MA}). Please check that the file was not damaged or edited incorrectly.`);
      return false;
    }
    const rawNstudies = Number(raw.n_studies);
    if (Number.isFinite(rawNstudies) && rawNstudies > MAX_N_STUDIES) {
      alert(`This file specifies ${raw.n_studies} studies, which exceeds the maximum this tool supports (${MAX_N_STUDIES}). Please check that the file was not damaged or edited incorrectly.`);
      return false;
    }
    const n_ma = Number.isFinite(rawNma) && rawNma >= 1 ? Math.round(rawNma) : 1;
    const n_studies = Number.isFinite(rawNstudies) && rawNstudies >= 1 ? Math.round(rawNstudies) : 1;

    const expectedVars = new Set(getAllVarnames(n_ma, n_studies));
    const errors = [];
    const unknownVars = [];
    const expectedImages = {};
    const sanitized = { n_ma, n_studies };

    Object.keys(raw).forEach((varname) => {
      if (varname === "n_ma" || varname === "n_studies" || varname === "robme_version") return;
      if (!expectedVars.has(varname)) { unknownVars.push(varname); return; }
      const value = raw[varname];

      if (isNumericField(varname)) {
        if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          errors.push(`"${varname}" should be a number (0 or more), but was "${value}".`);
          return;
        }
        sanitized[varname] = value === "" ? "" : Number(value);
        return;
      }

      const choices = csvFieldChoices(varname);
      if (choices) {
        if (!choices.includes(value)) {
          errors.push(`"${varname}" should be one of: ${choices.filter(Boolean).join(", ")} (or blank), but was "${value}".`);
          return;
        }
        sanitized[varname] = value;
        return;
      }

      if (isImageField(varname)) {
        if (value) expectedImages[varname] = value;
        return;
      }

      sanitized[varname] = value;
    });

    if (errors.length) {
      alert(`This file contains ${errors.length} invalid value(s) and cannot be loaded:\n\n${errors.join("\n")}\n\nPlease correct the listed value(s) in a spreadsheet application, then try again.`);
      return false;
    }

    if (hasMeaningfulProgress() && !confirm(
      "Loading this file will replace your current progress on this page. Continue?"
    )) {
      return false;
    }

    // Explicit per-image assignments from the resume dialog (plot type + meta-analysis
    // number the user picked) drive matching now, not the filename the CSV happened to
    // record - the CSV's stored filename is only used below to flag genuinely missing images.
    const assignedVarnames = new Set();
    for (const { file, type, maIndex } of imageAssignments || []) {
      if (!maIndex || maIndex < 1 || maIndex > n_ma) continue;
      const varname = `${maIndex}_${type}_plot_data`;
      sanitized[varname] = { name: file.name, dataUrl: await fileToDataUrl(file) };
      assignedVarnames.add(varname);
    }
    const missingImages = Object.keys(expectedImages)
      .filter((varname) => !assignedVarnames.has(varname))
      .map((varname) => expectedImages[varname]);

    state.answers = sanitized;
    state.currentPageIndex = 0;
    buildPages();
    render();
    scheduleAutosave();

    const notes = [];
    if (unknownVars.length) {
      notes.push(`${unknownVars.length} field(s) in the file were not recognized and have been ignored: ${unknownVars.join(", ")}`);
    }
    if (missingImages.length) {
      notes.push(`${missingImages.length} referenced image file(s) were not provided and are missing: ${missingImages.join(", ")}. Please upload them on the relevant Step 4 page if needed.`);
    }
    if (notes.length) alert(`Your progress file has been loaded, but with the following note(s):\n\n${notes.join("\n\n")}`);
    return true;
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveNow, 500);
  }

  function autosaveNow() {
    const payload = {
      schema_version: SCHEMA_VERSION,
      answers: state.answers,
      currentPageIndex: state.currentPageIndex,
    };
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      flashAutosaveStatus("Saved locally just now");
      autosaveQuotaWarningShown = false;
    } catch (err) {
      flashAutosaveStatus("Local autosave unavailable");
      // The 2.5s status flash above is easy to miss, and a quota failure
      // means real, silent data-loss risk (nothing survives a refresh/close
      // until the user explicitly exports) — most commonly triggered by a
      // large uploaded plot image pushing the whole session past the
      // browser's localStorage quota (typically ~5-10MB). Surface a harder
      // one-time warning so it isn't missed, without re-alerting on every
      // subsequent keystroke while the condition persists.
      if (err && err.name === "QuotaExceededError" && !autosaveQuotaWarningShown) {
        autosaveQuotaWarningShown = true;
        alert(
          "Your progress can no longer be auto-saved locally in this browser — the session data (likely a large uploaded plot image) is too big for local storage. " +
          "Your work in this tab is fine for now, but it will NOT survive a page refresh or closed tab. " +
          "Please use \"Save Progress\" soon to download a durable copy, and consider using a smaller/compressed plot image."
        );
      }
    }
  }

  function flashAutosaveStatus(text) {
    const el = document.getElementById("autosave-status");
    if (!el) return;
    el.textContent = text;
    if (autosaveStatusTimer) clearTimeout(autosaveStatusTimer);
    autosaveStatusTimer = setTimeout(() => { el.textContent = ""; }, 2500);
  }

  // Local autosave is a crash/forgot-to-save safety net, separate from the
  // explicit JSON Save/Upload files, which remain the portable, durable copy.
  function tryRestoreAutosave() {
    let raw;
    try {
      raw = localStorage.getItem(AUTOSAVE_KEY);
    } catch (err) {
      return false;
    }
    if (!raw) return false;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return false;
    }
    if (!parsed || typeof parsed.answers !== "object") return false;
    const hasRealAnswers = Object.keys(parsed.answers).some(
      (key) => key !== "n_ma" && String(parsed.answers[key] || "").trim() !== ""
    );
    if (!hasRealAnswers) return false;

    const result = sanitizeImportedAnswers(parsed.answers);
    if (!result.valid) return false; // corrupted localStorage — safer to start fresh than crash

    state.answers = result.answers;
    state.currentPageIndex = Number(parsed.currentPageIndex) || 0;
    return true;
  }

  function showRestoreBanner() {
    const el = document.getElementById("restore-banner");
    if (el) el.hidden = false;
  }

  function hideRestoreBanner() {
    const el = document.getElementById("restore-banner");
    if (el) el.hidden = true;
  }

  function showMultiTabBanner() {
    const el = document.getElementById("multitab-banner");
    if (el) el.hidden = false;
  }

  function hideMultiTabBanner() {
    const el = document.getElementById("multitab-banner");
    if (el) el.hidden = true;
  }

  // Autosave writes the whole session to one shared localStorage key with no
  // per-tab isolation, so two tabs open at once will silently clobber each
  // other's progress (last write wins, no merge). The `storage` event only
  // fires in *other* same-origin tabs/windows, never the one that made the
  // change, so any event we see here is proof another tab just wrote —
  // surface a warning rather than let it happen invisibly. This can't
  // prevent the overwrite (that would need a cross-tab locking scheme, which
  // risks permanently locking out a tab if its "owner" tab crashes without
  // releasing it) — it just makes sure the user finds out.
  function handleStorageEvent(e) {
    if (e.key !== AUTOSAVE_KEY || !e.newValue) return;
    if (hasMeaningfulProgress()) showMultiTabBanner();
  }

  // Anything the user has actually entered beyond the untouched default
  // ({n_ma: 1}) — used to decide whether uploading a file risks real data loss.
  function hasMeaningfulProgress() {
    return Object.keys(state.answers).some((key) => {
      if (key === "n_ma") return false;
      const v = state.answers[key];
      if (v === undefined || v === null || v === "") return false;
      if (typeof v === "object") return true;
      return String(v).trim() !== "";
    });
  }

  // Validates and clamps an imported answers object before it's trusted —
  // guards against corrupted/hand-edited files (wrong type, absurd n_ma/
  // n_studies) trying to make the browser build a huge number of pages/rows.
  // Returns { valid: true, answers, warnings } or { valid: false, error }.
  function sanitizeImportedAnswers(answers) {
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return { valid: false, error: "This file is missing the expected 'answers' data." };
    }
    const warnings = [];
    const sanitized = Object.assign({}, answers);

    const rawNma = sanitized.n_ma;
    let n_ma = Number(rawNma);
    if (!Number.isFinite(n_ma) || n_ma < 1) {
      n_ma = 1;
      warnings.push("The number of meta-analyses was missing or invalid. Reset to 1.");
    } else if (n_ma > MAX_N_MA) {
      return { valid: false, error: `This file specifies ${rawNma} meta-analyses, which is far more than this tool supports (max ${MAX_N_MA}). The file may be corrupted.` };
    } else {
      n_ma = Math.round(n_ma);
    }
    sanitized.n_ma = n_ma;

    const rawNstudies = sanitized.n_studies;
    let n_studies = Number(rawNstudies);
    if (rawNstudies === undefined) {
      n_studies = 1;
    } else if (!Number.isFinite(n_studies) || n_studies < 1) {
      n_studies = 1;
      warnings.push("The number of studies was missing or invalid. Reset to 1.");
    } else if (n_studies > MAX_N_STUDIES) {
      return { valid: false, error: `This file specifies ${rawNstudies} studies, which is far more than this tool supports (max ${MAX_N_STUDIES}). The file may be corrupted.` };
    } else {
      n_studies = Math.round(n_studies);
    }
    sanitized.n_studies = n_studies;

    return { valid: true, answers: sanitized, warnings };
  }

  // Resume dialog plot images: each uploaded file becomes a row the user
  // explicitly assigns a plot type + meta-analysis number to, rather than
  // relying on the filename matching what the CSV recorded.
  const RESUME_MA_OPTIONS_MAX = 30;
  let pendingResumeImages = [];

  // Best-effort filename parse, used only to pre-fill the dropdowns below -
  // never to silently assign without the user confirming, since
  // confirmResumeDialog still requires every row to have a meta-analysis
  // selected. Recognizes the documented "forest_MA1" / "funnel_MA1" naming
  // convention (resume-dialog hint + user guide) in either type-then-number
  // or number-then-type order, case-insensitive, with "_"/"-"/space/no
  // separator - plus the app's own export naming (rob-me_ma1_forest_plot.png),
  // which happens to already fit the same pattern.
  function guessImageAssignmentFromFilename(name) {
    const base = name || "";
    const match = /(forest|funnel)[_\-\s]*ma[_\-\s]*(\d+)/i.exec(base)
      || /ma[_\-\s]*(\d+)[_\-\s]*(forest|funnel)/i.exec(base);
    if (!match) return { type: undefined, maIndex: undefined };
    const type = (/^(forest|funnel)$/i.test(match[1]) ? match[1] : match[2]).toLowerCase();
    const maIndex = Number(/^\d+$/.test(match[1]) ? match[1] : match[2]);
    return { type, maIndex };
  }

  function addPendingResumeImages(files, defaultType) {
    Array.from(files || []).forEach((file) => {
      const guess = guessImageAssignmentFromFilename(file.name);
      pendingResumeImages.push({
        file,
        type: guess.type || defaultType,
        maIndex: guess.maIndex || "",
      });
    });
    renderResumeImageRows();
  }

  function renderResumeImageRows() {
    const wrap = document.getElementById("resume-image-rows");
    if (!wrap) return;
    wrap.innerHTML = "";
    pendingResumeImages.forEach((row, idx) => {
      const rowEl = document.createElement("div");
      rowEl.className = "resume-image-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "resume-image-name";
      nameSpan.textContent = row.file.name;
      rowEl.appendChild(nameSpan);

      const typeSelect = document.createElement("select");
      typeSelect.setAttribute("aria-label", `Plot type for ${row.file.name}`);
      [["forest", "Forest plot"], ["funnel", "Funnel plot"]].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        if (row.type === value) option.selected = true;
        typeSelect.appendChild(option);
      });
      typeSelect.addEventListener("change", () => { row.type = typeSelect.value; });
      rowEl.appendChild(typeSelect);

      const maSelect = document.createElement("select");
      maSelect.setAttribute("aria-label", `Meta-analysis for ${row.file.name}`);
      const blankOption = document.createElement("option");
      blankOption.value = "";
      blankOption.textContent = "Meta-analysis…";
      if (!row.maIndex) blankOption.selected = true;
      maSelect.appendChild(blankOption);
      for (let i = 1; i <= RESUME_MA_OPTIONS_MAX; i++) {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = `Meta-analysis ${i}`;
        if (Number(row.maIndex) === i) option.selected = true;
        maSelect.appendChild(option);
      }
      maSelect.addEventListener("change", () => { row.maIndex = maSelect.value ? Number(maSelect.value) : ""; });
      rowEl.appendChild(maSelect);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove ${row.file.name}`);
      removeBtn.addEventListener("click", () => {
        pendingResumeImages.splice(idx, 1);
        renderResumeImageRows();
      });
      rowEl.appendChild(removeBtn);

      wrap.appendChild(rowEl);
    });
  }

  function openResumeDialog() {
    const dialog = document.getElementById("resume-dialog");
    document.getElementById("resume-csv-input").value = "";
    document.getElementById("resume-forest-input").value = "";
    document.getElementById("resume-funnel-input").value = "";
    pendingResumeImages = [];
    renderResumeImageRows();
    dialog.showModal();
  }

  function confirmResumeDialog() {
    const csvInput = document.getElementById("resume-csv-input");
    if (!csvInput.files[0]) {
      alert("Please select your saved .csv progress file first.");
      return;
    }
    if (pendingResumeImages.some((row) => !row.maIndex)) {
      alert("Please choose which meta-analysis each uploaded plot image belongs to before loading.");
      return;
    }
    const dialog = document.getElementById("resume-dialog");
    const imageAssignments = pendingResumeImages.map((row) => (
      { file: row.file, type: row.type, maIndex: Number(row.maIndex) }
    ));
    importProgressCsv(csvInput.files[0], imageAssignments).then((success) => {
      if (success) dialog.close();
    });
  }

  function wireNav() {
    document.body.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      if (action === "prev") goToIndex(state.currentPageIndex - 1);
      if (action === "next") goToIndex(state.currentPageIndex + 1);
      if (action === "save-progress") exportProgressCsv();
      if (action === "open-resume-dialog") openResumeDialog();
      if (action === "resume-cancel") document.getElementById("resume-dialog").close();
      if (action === "resume-confirm") confirmResumeDialog();
      if (action === "dismiss-restore") hideRestoreBanner();
      if (action === "dismiss-multitab") hideMultiTabBanner();
      if (action === "discard-restore") {
        try { localStorage.removeItem(AUTOSAVE_KEY); } catch (err) { /* ignore */ }
        state.answers = { n_ma: 1 };
        state.currentPageIndex = 0;
        buildPages();
        hideRestoreBanner();
        render();
      }
    });

    const forestInput = document.getElementById("resume-forest-input");
    if (forestInput) forestInput.addEventListener("change", () => {
      addPendingResumeImages(forestInput.files, "forest");
      forestInput.value = "";
    });
    const funnelInput = document.getElementById("resume-funnel-input");
    if (funnelInput) funnelInput.addEventListener("change", () => {
      addPendingResumeImages(funnelInput.files, "funnel");
      funnelInput.value = "";
    });
  }

  buildPages();
  const restored = tryRestoreAutosave();
  if (restored) buildPages();
  if (state.currentPageIndex >= pages.length) state.currentPageIndex = 0;
  wireNav();
  render();
  if (restored) showRestoreBanner();

  // A refresh/close can land in the middle of the 500ms autosave debounce —
  // flush immediately (synchronously, since the page is about to unload) so
  // at most a few keystrokes are ever at risk, not up to half a second.
  window.addEventListener("beforeunload", () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveNow();
    }
  });

  window.addEventListener("storage", handleStorageEvent);
})();
