/* DOM id / dynamic button whitelist check — run with: node check-dom.js */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const game = fs.readFileSync(path.join(root, "js", "game.js"), "utf8");

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log("PASS", msg);
  else {
    console.error("FAIL", msg);
    failed++;
  }
}

// ids referenced in game.js via $("#...") or getElementById
const idRefs = [...game.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((m) =>m[1]);
const getElement = [...game.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]);
const idsNeeded = [...new Set([...idRefs, ...getElement])];

const htmlIds = [...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const htmlIdSet = new Set(htmlIds);

// ids created dynamically in game.js templates
const dynamicIds = [...game.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const dynamicSet = new Set(dynamicIds);

const missing = idsNeeded.filter((id) => !htmlIdSet.has(id) && !dynamicSet.has(id));
ok(missing.length === 0, "all game.js ids exist in html or dynamic templates; missing=" + missing.join(","));

// data-screen set
const screens = [...html.matchAll(/data-screen="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const expectedScreens = ["doc", "pick", "hub", "prep", "battle", "result", "champion"];
for (const s of expectedScreens) {
  ok(screens.includes(s), `screen ${s} present`);
}

// script order
const scripts = [...html.matchAll(/src="(js\/[A-Za-z0-9_.-]+)"/g)].map((m) => m[1]);
const order = ["js/roster.js", "js/data.js", "js/radar.js", "js/engine.js", "js/anim.js", "js/game.js"];
ok(JSON.stringify(scripts) === JSON.stringify(order), "script load order correct: " + scripts.join(" → "));

// dynamic button whitelist
const dataAttrs = [...game.matchAll(/data-([a-z-]+)=/g)].map((m) => m[1]);
const allowed = new Set(["team", "nav", "play-match", "sim-match", "sim-rest", "advance", "lineup", "style"]);
const unknown = [...new Set(dataAttrs)].filter((a) => !allowed.has(a) && !["screen"].includes(a));
// data-screen is in html not game; game may reference data-play-match etc via closest
ok(unknown.length === 0, "dynamic data-* attrs whitelisted; unknown=" + unknown.join(","));

// required buttons in html
for (const id of ["btnEnter", "btnConfirmPick", "btnToStrategy", "btnBattleNext", "btnResultNext"]) {
  ok(htmlIdSet.has(id), `button ${id} in html`);
}

console.log("\n" + (failed ? `FAILED ${failed}` : "ALL PASS"));
process.exit(failed ? 1 : 0);
