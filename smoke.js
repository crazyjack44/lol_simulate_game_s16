/* Engine smoke tests — run with: node smoke.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const context = { window: {}, console, Math, JSON, performance: { now: () => Date.now() } };
context.window = context;
context.globalThis = context;
vm.createContext(context);

function load(file) {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(code, context, { filename: file });
}

load("js/roster.js");
load("js/data.js");
load("js/engine.js");

const S16 = context.S16 || context.window.S16;
if (!S16) {
  console.error("FAIL: S16 namespace missing");
  process.exit(1);
}
S16.applyRoster();

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log("PASS", msg);
  else {
    console.error("FAIL", msg);
    failed++;
  }
}

// roster
ok(Array.isArray(S16.ROSTER) && S16.ROSTER.length === 16, "16 teams in ROSTER");
const t1 = S16.TEAMS.find((t) => t.id === "T1");
ok(!!t1, "T1 exists");
if (t1) {
  const names = t1.roster.map((p) => p.name);
  const expected = ["Doran", "Oner", "Faker", "Peyz", "Keria"];
  ok(JSON.stringify(names) === JSON.stringify(expected), "T1 five-man is Doran/Oner/Faker/Peyz/Keria, got " + names.join(","));
  ok(names.every(Boolean) && t1.roster.every((p) => p.photo), "T1 photos present");
  ok(t1.power >= 70 && t1.power <= 96, "T1 power in 70-96");
}

// all teams power band
ok(S16.TEAMS.every((t) => t.power >= 70 && t.power <= 96), "all powers in 70-96");
ok(S16.TEAMS.every((t) => t.roster.length === 5), "all teams have 5 roles");
ok(S16.TEAMS.every((t) => t.teamRadar && Object.keys(t.teamRadar).length >= 4), "all teams have teamRadar");

// style counter ring
ok(S16.Engine.styleEdge("engage", "protect") === 1.08, "engage beats protect");
ok(S16.Engine.styleEdge("protect", "engage") === 0.93, "protect loses to engage");
ok(S16.Engine.styleEdge("engage", "teamfight") === 1, "neutral edge engage vs teamfight");
ok(S16.Engine.styleEdge("split", "engage") === 1.08, "split beats engage");

// event counter
ok(S16.Engine.counterEdge("invade", "lane", "early") === "a", "invade beats lane");
ok(S16.Engine.counterEdge("lane", "invade", "early") === "b", "lane loses to invade");
ok(S16.Engine.counterEdge("rush", "wrap", "baron") === "a", "rush beats wrap");

// predictEvents normalize
const preds = S16.Engine.predictEvents({
  phase: "early",
  myStyle: "engage",
  foeStyle: "protect",
  myPower: 85,
  foePower: 84,
  ecoMe: 0,
  ecoFoe: 0,
});
const sum = preds.reduce((a, r) => a + r.prob, 0);
ok(Math.abs(sum - 1) < 1e-6, "predictEvents probs sum to 1");
ok(preds.length === 3, "early has 3 candidates");
ok(preds.every((r) => r.factors && typeof r.factors.phase === "number"), "factors present");

// simulateMatch
const blue = S16.TEAMS.find((t) => t.id === "BLG");
const red = S16.TEAMS.find((t) => t.id === "T1");
const result = S16.Engine.simulateMatch({
  blue,
  red,
  blueLineup: "signature",
  redLineup: "meta",
  blueStyle: "engage",
  redStyle: "teamfight",
});
ok(result.rounds.length === 3, "3 phase rounds");
ok(result.winner === "blue" || result.winner === "red", "has winner");
ok(typeof result.killsB === "number" && typeof result.killsR === "number", "kills numeric");
ok(result.predHitRate >= 0 && result.predHitRate <= 1, "pred hit rate in range");

// killFeed unique victims within a fight
const fight = S16.Engine.simulateTeamfight({
  blue,
  red,
  bluePower: 85,
  redPower: 84,
  ecoB: 1,
  ecoR: 1,
  styleEdgeB: 1,
  styleEdgeR: 1,
  edgeB: 1,
  edgeR: 1,
  objective: "baron",
});
ok(Array.isArray(fight.killFeed) && fight.killFeed.length >= 1, "killFeed non-empty");
const victims = fight.killFeed.map((k) => k.victim);
ok(new Set(victims).size === victims.length, "killFeed victims are unique, got " + victims.join(","));
ok(fight.killFeed.every((k) => k.killer && k.victim && k.text), "killFeed fields");
// simulate many fights — no duplicate deaths ever
let dup = 0;
for (let i = 0; i < 200; i++) {
  const f = S16.Engine.simulateTeamfight({
    blue,
    red,
    bluePower: 85,
    redPower: 84,
    ecoB: 1,
    ecoR: 1,
    styleEdgeB: 1,
    styleEdgeR: 1,
    edgeB: 1,
    edgeR: 1,
    objective: "baron",
  });
  const vs = f.killFeed.map((k) => k.victim);
  if (new Set(vs).size !== vs.length) dup++;
}
ok(dup === 0, "200 teamfights have unique victims (dups=" + dup + ")");

// style ring membership
ok(S16.Engine.styleEdge("gadget", "protect") !== undefined, "gadget styleEdge works");
ok(S16.normalizeStyle("gadget") === "split", "gadget normalizes into ring");
const g2 = S16.TEAMS.find((t) => t.id === "G2");
const c9 = S16.TEAMS.find((t) => t.id === "C9");
ok(["engage", "protect", "split", "teamfight"].includes(g2.style), "G2 style in ring: " + g2.style);
ok(["engage", "protect", "split", "teamfight"].includes(c9.style), "C9 style in ring: " + c9.style);

// drawGroupStage
const groups = S16.Engine.drawGroupStage(S16.TEAMS);
ok(groups.length === 8, "8 group matches");
const ids = groups.flatMap((m) => [m.blue, m.red]);
ok(new Set(ids).size === 16, "all 16 teams used once");

// softmax helper
const sm = S16.Engine.softmax([1, 2, 3], 1.15);
ok(Math.abs(sm.reduce((a, b) => a + b, 0) - 1) < 1e-9, "softmax normalize");

console.log("\n" + (failed ? `FAILED ${failed}` : "ALL PASS"));
process.exit(failed ? 1 : 0);
