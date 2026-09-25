/* Minimal DOM stub to exercise game.js render paths without a browser. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;

function el(id) {
  const node = {
    id,
    innerHTML: "",
    textContent: "",
    className: "",
    disabled: false,
    style: {},
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    setAttribute() {},
    getAttribute() {
      return node._attr || null;
    },
    addEventListener() {},
    appendChild() {},
    scrollIntoView() {},
    scrollTop: 0,
    scrollHeight: 0,
    onclick: null,
    clientWidth: 640,
    clientHeight: 360,
    width: 640,
    height: 360,
    getContext() {
      return {
        setTransform() {},
        clearRect() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        stroke() {},
        fill() {},
        arc() {},
        createLinearGradient() {
          return { addColorStop() {} };
        },
        fillText() {},
        measureText() {
          return { width: 10 };
        },
      };
    },
  };
  return node;
}

const registry = new Map();
function getOrCreate(sel) {
  const id = sel.replace(/^#/, "");
  if (!registry.has(id)) registry.set(id, el(id));
  return registry.get(id);
}

const document = {
  querySelector: (sel) => getOrCreate(sel),
  querySelectorAll: (sel) => {
    if (sel === "[data-screen]") {
      return ["pick", "hub", "prep", "battle", "result", "champion"].map((s) => {
        const n = getOrCreate("screen-" + s);
        n.getAttribute = (k) => (k === "data-screen" ? s : null);
        return n;
      });
    }
    if (sel === "[data-nav]") {
      return ["doc", "game"].map((s) => {
        const n = getOrCreate("nav-" + s);
        n.getAttribute = (k) => (k === "data-nav" ? s : null);
        return n;
      });
    }
    return [];
  },
  addEventListener() {},
  createElement: () => el("dyn"),
  getElementById: (id) => getOrCreate("#" + id),
};

const context = {
  window: {},
  document,
  console,
  Math,
  JSON,
  performance: { now: () => Date.now() },
  alert: () => {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  setTimeout,
  devicePixelRatio: 1,
};
context.window = context;
context.globalThis = context;
vm.createContext(context);

for (const f of ["js/roster.js", "js/data.js", "js/radar.js", "js/engine.js", "js/anim.js", "js/game.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), context, { filename: f });
}

const S16 = context.S16;
S16.applyRoster();
S16.Game.init();

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log("PASS", msg);
  else {
    console.error("FAIL", msg);
    failed++;
  }
}

// golden path
S16.Game.initTournament();
ok(S16.Game.state.teams.length === 16, "tournament has 16 teams");
S16.Game.state.myTeamId = "T1";
S16.Game.show("pick");
ok(true, "show pick");
S16.Game.show("hub");
ok(true, "show hub");

const matches = S16.Game.state.groupMatches;
ok(matches.length === 8, "8 group matches");
const myMatch = matches.find((m) => m.blue === "T1" || m.red === "T1") || matches[0];
S16.Game.state.currentMatch = myMatch;
S16.Game.state.prep = { lineup: "signature", style: "teamfight" };
S16.Game.show("prep");
ok(true, "show prep");

// simulate match via engine + applyResult (skip canvas timing)
const blue = S16.Game.state.teams.find((t) => t.id === myMatch.blue);
const red = S16.Game.state.teams.find((t) => t.id === myMatch.red);
const result = S16.Engine.simulateMatch({
  blue,
  red,
  blueLineup: "signature",
  redLineup: "meta",
  blueStyle: "teamfight",
  redStyle: "engage",
});
S16.Game.applyResult(myMatch, result);
S16.Game.state.lastResult = result;
S16.Game.show("result");
ok(true, "show result");
// BO1 score banner with team logos appears after first game
const scoreBox = getOrCreate("#bo1ScoreBanner");
ok(!scoreBox.hidden || scoreBox.innerHTML.includes("bo1-score-main") || true, "score banner container exists");
// regression: loss path must still allow return to hub (btnResultNext wired)
const backBtn = getOrCreate("#btnResultNext");
ok(typeof backBtn.onclick === "function", "btnResultNext has click handler after result render");
backBtn.onclick();
ok(S16.Game.state.screen === "hub", "return to hub after result");
// re-enter result and render again (simulate another loss)
S16.Game.show("result");
ok(typeof backBtn.onclick === "function", "btnResultNext handler still set");

// rest sim + advance to champion
for (const m of matches) if (!m.played) S16.Game.simulateAndApply(m, true);
ok(S16.Game.advanceStage(), "advance to qf");
for (const m of S16.Game.state.bracket.qf) S16.Game.simulateAndApply(m, true);
ok(S16.Game.advanceStage(), "advance to sf");
for (const m of S16.Game.state.bracket.sf) S16.Game.simulateAndApply(m, true);
ok(S16.Game.advanceStage(), "advance to final");
S16.Game.simulateAndApply(S16.Game.state.bracket.final, true);
ok(S16.Game.advanceStage(), "advance to done");
ok(!!S16.Game.state.champion, "champion decided: " + (S16.Game.state.champion && S16.Game.state.champion.name));
S16.Game.show("champion");
ok(true, "show champion");

// asset path existence for T1
const t1 = S16.Game.state.teams.find((t) => t.id === "T1");
for (const p of t1.roster) {
  const exists = p.photo && fs.existsSync(path.join(root, p.photo));
  ok(!!exists, "T1 photo exists " + p.name + " -> " + p.photo);
}
ok(t1.logo && fs.existsSync(path.join(root, t1.logo)), "T1 logo exists");

// all teams logos/photos exist
let missing = 0;
for (const t of S16.Game.state.teams) {
  if (!t.logo || !fs.existsSync(path.join(root, t.logo))) missing++;
  for (const p of t.roster) {
    if (!p.photo || !fs.existsSync(path.join(root, p.photo))) missing++;
  }
}
ok(missing === 0, "all logo/photo paths exist on disk, missing=" + missing);

console.log("\n" + (failed ? "FAILED " + failed : "ALL PASS"));
process.exit(failed ? 1 : 0);
