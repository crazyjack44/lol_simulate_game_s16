/* Game flow, UI rendering, tournament progression */
window.S16 = window.S16 || {};

S16.Game = (() => {
  const state = {
    screen: "doc",
    myTeamId: null,
    teams: [],
    groupMatches: [],
    standings: {},
    bracket: { qf: [], sf: [], final: null },
    stage: "group",
    currentMatch: null,
    prep: { lineup: "meta", style: "engage" },
    lastResult: null,
    champion: null,
    playerSide: "blue",
    simIdx: 0,
    _preview: null,
    _anim: null,
    _playing: false,
    _pendingResult: null,
    _autoTimer: null,
  };

  const POS_ORDER = ["top", "jng", "mid", "bot", "sup"];

  function $(sel) {
    return document.querySelector(sel);
  }

  function $all(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  function teamById(id) {
    return state.teams.find((t) => t.id === id);
  }

  function show(screen) {
    state.screen = screen;
    $all("[data-screen]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-screen") === screen);
    });
    $all("[data-nav]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-nav") === (screen === "doc" ? "doc" : "game"));
    });
    if (screen === "pick") renderPick();
    if (screen === "hub") renderHub();
    if (screen === "prep") renderPrep();
    if (screen === "battle") renderBattleShell();
    if (screen === "result") renderResult();
    if (screen === "champion") renderChampion();
  }

  function initTournament() {
    const teams = S16.applyRoster();
    state.teams = teams;
    state.groupMatches = S16.Engine.drawGroupStage(teams);
    state.standings = {};
    teams.forEach((t) => {
      state.standings[t.id] = { id: t.id, win: 0, loss: 0, kills: 0, deaths: 0, pts: 0 };
    });
    state.bracket = { qf: [], sf: [], final: null };
    state.stage = "group";
    state.champion = null;
  }

  function applyResult(match, result) {
    match.played = true;
    match.result = {
      winner: result.winner,
      scoreB: result.scoreB,
      scoreR: result.scoreR,
      killsB: result.killsB,
      killsR: result.killsR,
      marginText: result.marginText,
    };
    const winId = result.winner === "blue" ? match.blue : match.red;
    const loseId = result.winner === "blue" ? match.red : match.blue;
    if (state.standings[winId]) {
      state.standings[winId].pts += 3;
      state.standings[winId].win += 1;
    }
    if (state.standings[loseId]) state.standings[loseId].loss += 1;
    if (state.standings[match.blue]) {
      state.standings[match.blue].kills += result.killsB;
      state.standings[match.blue].deaths += result.killsR;
    }
    if (state.standings[match.red]) {
      state.standings[match.red].kills += result.killsR;
      state.standings[match.red].deaths += result.killsB;
    }
    state.lastResult = { matchId: match.id, ...result };
  }

  function simulateAndApply(match, silent) {
    const blue = teamById(match.blue);
    const red = teamById(match.red);
    const bp = S16.Engine.autoPicks(blue);
    const rp = S16.Engine.autoPicks(red);
    const result = S16.Engine.simulateMatch({
      blue,
      red,
      blueLineup: bp.lineup,
      redLineup: rp.lineup,
      blueStyle: bp.style,
      redStyle: rp.style,
    });
    applyResult(match, result);
    if (!silent) {
      // brief toast via log
    }
    return result;
  }

  function advanceStage() {
    if (state.stage === "group") {
      const played = state.groupMatches.every((m) => m.played);
      if (!played) return false;
      const ranked = Object.values(state.standings).sort(
        (a, b) => b.pts - a.pts || b.kills - b.deaths - (a.kills - a.deaths) || b.kills - a.kills
      );
      const top8 = ranked.slice(0, 8).map((r) => r.id);
      const pairings = [
        [0, 7],
        [3, 4],
        [1, 6],
        [2, 5],
      ];
      state.bracket.qf = pairings.map(([a, b], i) => ({
        id: "qf" + (i + 1),
        stage: "qf",
        blue: top8[a],
        red: top8[b],
        played: false,
        result: null,
      }));
      state.stage = "qf";
      return true;
    }
    if (state.stage === "qf") {
      if (!state.bracket.qf.every((m) => m.played)) return false;
      const w = state.bracket.qf.map((m) => (m.result.winner === "blue" ? m.blue : m.red));
      state.bracket.sf = [
        { id: "sf1", stage: "sf", blue: w[0], red: w[1], played: false, result: null },
        { id: "sf2", stage: "sf", blue: w[2], red: w[3], played: false, result: null },
      ];
      state.stage = "sf";
      return true;
    }
    if (state.stage === "sf") {
      if (!state.bracket.sf.every((m) => m.played)) return false;
      const w = state.bracket.sf.map((m) => (m.result.winner === "blue" ? m.blue : m.red));
      state.bracket.final = {
        id: "final",
        stage: "final",
        blue: w[0],
        red: w[1],
        played: false,
        result: null,
      };
      state.stage = "final";
      return true;
    }
    if (state.stage === "final") {
      if (!state.bracket.final || !state.bracket.final.played) return false;
      const fid = state.bracket.final.result.winner === "blue" ? state.bracket.final.blue : state.bracket.final.red;
      state.champion = teamById(fid);
      state.stage = "done";
      return true;
    }
    return false;
  }

  function currentMatches() {
    if (state.stage === "group") return state.groupMatches;
    if (state.stage === "qf") return state.bracket.qf;
    if (state.stage === "sf") return state.bracket.sf;
    if (state.stage === "final") return state.bracket.final ? [state.bracket.final] : [];
    return [];
  }

  function nextPlayerMatch() {
    const ms = currentMatches();
    return ms.find((m) => !m.played) || null;
  }

  function stageName(stage) {
    return { group: "积分赛", qf: "八强", sf: "半决赛", final: "决赛", done: "已结束" }[stage] || stage;
  }

  // ---------- renderers ----------

  function renderPick() {
    const grid = $("#teamGrid");
    if (!grid) return;
    grid.innerHTML = state.teams
      .map(
        (t) => `
      <button class="team-card ${state.myTeamId === t.id ? "selected" : ""}" data-team="${t.id}">
        <div class="team-card-top">
          ${t.logo ? `<img class="team-logo" src="${t.logo}" alt="${t.short}" />` : `<span class="team-logo-fallback">${t.short}</span>`}
          <div>
            <div class="team-card-name">${t.name}</div>
            <div class="team-card-meta">${t.region} · 战力 <strong>${t.power.toFixed(1)}</strong></div>
          </div>
        </div>
        <div class="team-card-roster">
          ${t.roster
            .map(
              (p) => `
            <div class="roster-chip" title="${p.name}">
              ${p.photo ? `<img src="${p.photo}" alt="${p.name}" />` : `<span>${p.name.slice(0, 2)}</span>`}
              <em>${p.posCn}</em>
            </div>`
            )
            .join("")}
        </div>
        <div class="team-card-note">${t.note}</div>
      </button>`
      )
      .join("");

    grid.onclick = (e) => {
      const btn = e.target.closest("[data-team]");
      if (!btn) return;
      state.myTeamId = btn.getAttribute("data-team");
      renderPick();
    };

    const preview = $("#pickRadar");
    const detail = $("#pickDetail");
    const t = teamById(state.myTeamId);
    if (!t) {
      if (detail) detail.innerHTML = `<p class="muted">选择一支战队，查看真实赛段雷达与五路名单。</p>`;
      return;
    }
    if (detail) {
      detail.innerHTML = `
        <div class="pick-detail-head">
          ${t.logo ? `<img src="${t.logo}" alt="" class="team-logo lg" />` : ""}
          <div>
            <h3>${t.name}</h3>
            <p class="muted">${t.region} · ${t.dataSource} · ${t.season}</p>
            <p>${t.note}</p>
          </div>
        </div>
        <div class="role-grid">
          ${t.roster
            .map(
              (p) => `
            <div class="role-card">
              ${p.photo ? `<img src="${p.photo}" alt="${p.name}" class="role-photo" />` : `<div class="role-photo fallback"></div>`}
              <div class="role-meta">
                <strong>${p.name}</strong>
                <span>${p.posCn}</span>
                <div class="mini-wrap">${S16.Radar.roleMiniBars(p.radar)}</div>
              </div>
            </div>`
            )
            .join("")}
        </div>
      `;
    }
    if (preview) {
      S16.Radar.drawRadar(
        preview,
        [
          {
            values: t.teamRadar,
            color: "#c8aa6e",
            fill: "rgba(200,170,110,0.22)",
          },
        ],
        { width: 280, height: 280 }
      );
    }
  }

  function renderHub() {
    const bracket = $("#bracket");
    const standingsList = $("#standingsList");
    const hubActions = $("#hubActions");
    const stageLabel = $("#hubStage");
    if (stageLabel) stageLabel.textContent = stageName(state.stage);

    // standings
    if (standingsList) {
      const ranked = Object.values(state.standings).sort(
        (a, b) => b.pts - a.pts || b.kills - b.deaths - (a.kills - a.deaths) || b.kills - a.kills
      );
      standingsList.innerHTML = `
        <div class="standings-row head"><span>#</span><span>战队</span><span>胜</span><span>负</span><span>击杀</span><span>积分</span></div>
        ${ranked
          .map(
            (r, i) => `
          <div class="standings-row ${r.id === state.myTeamId ? "me" : ""}">
            <span>${i + 1}</span>
            <span class="standings-team">${(teamById(r.id) || {}).short || r.id}</span>
            <span>${r.win}</span><span>${r.loss}</span>
            <span>${r.kills}</span><span>${r.pts}</span>
          </div>`
          )
          .join("")}
      `;
    }

    // bracket
    if (bracket) {
      const qf = state.bracket.qf.length
        ? state.bracket.qf
        : state.groupMatches;
      const cards = currentMatches();
      const html = cards
        .map((m) => {
          const b = teamById(m.blue);
          const r = teamById(m.red);
          const isMine = m.blue === state.myTeamId || m.red === state.myTeamId;
          return `
          <div class="match-card ${isMine ? "mine" : ""} ${m.played ? "played" : ""}">
            <div class="match-card-stage">${stageName(m.stage)}</div>
            <div class="match-row"><span>${b ? b.short : m.blue}</span><strong>${m.played && m.result ? (m.result.winner === "blue" ? "胜" : "负") : "—"}</strong></div>
            <div class="match-row"><span>${r ? r.short : m.red}</span><strong>${m.played && m.result ? (m.result.winner === "red" ? "胜" : "负") : "—"}</strong></div>
            ${m.played && m.result ? `<div class="match-score">${m.result.killsB} - ${m.result.killsR} · ${m.result.marginText}</div>` : ""}
            ${
              isMine && !m.played
                ? `<button class="btn btn-primary btn-sm" data-play-match="${m.id}">亲自指挥</button>`
                : ""
            }
            ${
              !m.played
                ? `<button class="btn btn-ghost btn-sm" data-sim-match="${m.id}">模拟本场</button>`
                : ""
            }
          </div>`;
        })
        .join("");
      bracket.innerHTML = html;
    }

    if (hubActions) {
      const unplayed = currentMatches().filter((m) => !m.played);
      const myNext = nextPlayerMatch();
      const isMyTurn = myNext && (myNext.blue === state.myTeamId || myNext.red === state.myTeamId);
      hubActions.innerHTML = `
        ${
          isMyTurn
            ? `<button class="btn btn-primary" data-play-match="${myNext.id}">进入对局 · 亲自指挥</button>`
            : ""
        }
        <button class="btn" data-sim-rest="1">模拟剩余全部</button>
        <button class="btn btn-ghost" data-advance="1">推进阶段</button>
      `;
    }
  }

  function renderPrep() {
    const m = state.currentMatch;
    if (!m) return;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    state.playerSide = m.blue === state.myTeamId ? "blue" : "red";
    const my = state.playerSide === "blue" ? blue : red;
    const foe = state.playerSide === "blue" ? red : blue;

    const vsPanel = $("#vsPanel");
    if (vsPanel) {
      vsPanel.innerHTML = `
        <div class="vs-side blue">
          <div class="vs-side-head">${blue.logo ? `<img src="${blue.logo}" alt="" />` : ""}<div><strong>${blue.name}</strong><div class="muted">蓝方 · 战力 ${blue.power.toFixed(1)}</div></div></div>
          <div class="vs-roster">
            ${blue.roster.map((p) => `<div class="vs-player">${p.photo ? `<img src="${p.photo}" alt="${p.name}" />` : ""}<span>${p.name}</span><em>${p.posCn}</em></div>`).join("")}
          </div>
          <canvas id="vsRadar-blue" width="240" height="240"></canvas>
        </div>
        <div class="vs-center">VS<div class="muted">${stageName(m.stage)}</div></div>
        <div class="vs-side red">
          <div class="vs-side-head">${red.logo ? `<img src="${red.logo}" alt="" />` : ""}<div><strong>${red.name}</strong><div class="muted">红方 · 战力 ${red.power.toFixed(1)}</div></div></div>
          <div class="vs-roster">
            ${red.roster.map((p) => `<div class="vs-player">${p.photo ? `<img src="${p.photo}" alt="${p.name}" />` : ""}<span>${p.name}</span><em>${p.posCn}</em></div>`).join("")}
          </div>
          <canvas id="vsRadar-red" width="240" height="240"></canvas>
        </div>
      `;
      requestAnimationFrame(() => {
        const cb = $("#vsRadar-blue");
        const cr = $("#vsRadar-red");
        if (cb) S16.Radar.drawRadar(cb, [{ values: blue.teamRadar, color: "#0ac8b9", fill: "rgba(10,200,185,0.18)" }], { width: 220, height: 220 });
        if (cr) S16.Radar.drawRadar(cr, [{ values: red.teamRadar, color: "#e84057", fill: "rgba(232,64,87,0.18)" }], { width: 220, height: 220 });
      });
    }

    const lineupGrid = $("#lineupGrid");
    if (lineupGrid) {
      lineupGrid.innerHTML = S16.LINEUPS.map(
        (l) => `
        <button class="choice-card ${state.prep.lineup === l.id ? "selected" : ""}" data-lineup="${l.id}">
          <strong>${l.name}</strong>
          <p>${l.desc}</p>
          <span class="tag">${l.stat}</span>
        </button>`
      ).join("");
    }
    const styleGrid = $("#styleGrid");
    if (styleGrid) {
      styleGrid.innerHTML = S16.STYLES.map(
        (s) => `
        <button class="choice-card ${state.prep.style === s.id ? "selected" : ""}" data-style="${s.id}">
          <strong>${s.icon} ${s.name}</strong>
          <p>${s.desc}</p>
        </button>`
      ).join("");
    }

    const btn = $("#btnToStrategy");
    if (btn) btn.disabled = false;
  }

  function renderBattleShell() {
    const m = state.currentMatch;
    if (!m) return;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const phaseNow = $("#phaseNow");
    if (phaseNow) phaseNow.innerHTML = `<h3>推演观战</h3><p class="muted">${blue.short} vs ${red.short} · 程序自主推演</p>`;
    const log = $("#battleLog");
    if (log) log.innerHTML = "";
    const nextBtn = $("#btnBattleNext");
    if (nextBtn) nextBtn.disabled = true;
  }

  function startAutoMatch() {
    const m = state.currentMatch;
    if (!m) return;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const myIsBlue = m.blue === state.myTeamId;
    const result = S16.Engine.simulateMatch({
      blue,
      red,
      blueLineup: myIsBlue ? state.prep.lineup : S16.Engine.autoLineup(blue),
      redLineup: myIsBlue ? S16.Engine.autoLineup(red) : state.prep.lineup,
      blueStyle: myIsBlue ? state.prep.style : (blue.style || S16.Engine.autoPicks(blue).style),
      redStyle: myIsBlue ? (red.style || S16.Engine.autoPicks(red).style) : state.prep.style,
    });
    state._pendingResult = result;
    state.simIdx = 0;
    show("battle");
    playNextStep();
  }

  function appendLog(html) {
    const log = $("#battleLog");
    if (!log) return;
    const div = document.createElement("div");
    div.className = "log-line";
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function playNextStep() {
    const result = state._pendingResult;
    if (!result) return;
    if (state.simIdx >= result.rounds.length) {
      const nextBtn = $("#btnBattleNext");
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.onclick = () => finishMatch();
      }
      appendLog(`<div class="log-line done">推演结束 · 正在结算…</div>`);
      return;
    }

    const step = result.rounds[state.simIdx];
    const m = state.currentMatch;
    const blue = teamById(m.blue);
    const red = teamById(m.red);

    // prediction panel
    const predPanel = $("#predPanel");
    if (predPanel) {
      const top = step.predB || [];
      predPanel.innerHTML = `
        <div class="pred-title">下一步事件走向 · ${step.phaseName}</div>
        ${top
          .map(
            (row, i) => `
          <div class="pred-row">
            <span class="pred-rank">${i + 1}</span>
            <span class="pred-name">${row.ev.name}</span>
            <div class="pred-bar"><i style="width:${(row.prob * 100).toFixed(1)}%"></i></div>
            <span class="pred-prob">${(row.prob * 100).toFixed(1)}%</span>
          </div>`
          )
          .join("")}
        <div class="pred-factors">
          ${Object.entries((top[0] && top[0].factors) || {})
            .map(
              ([k, v]) =>
                `<span class="factor-chip" title="${k}">${S16.FACTOR_LABELS[k] || k} <strong>${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}</strong></span>`
            )
            .join("")}
        </div>
      `;
    }

    const phaseNow = $("#phaseNow");
    if (phaseNow) {
      phaseNow.innerHTML = `
        <h3>${step.phaseName}</h3>
        <div class="phase-reveal">
          <div class="ev blue">${blue.short} · <strong>${step.bEv.name}</strong> <em>${step.bEv.desc}</em></div>
          <div class="ev red">${red.short} · <strong>${step.rEv.name}</strong> <em>${step.rEv.desc}</em></div>
          <div class="edge">克制结果：<strong>${step.edge === "a" ? blue.short + " 占优" : step.edge === "b" ? red.short + " 占优" : step.edge === "mirror" ? "镜像" : "均势"}</strong>${step.force ? " · 经济差强行接团" : ""}</div>
        </div>
      `;
    }

    appendLog(`<div class="log-line">【${step.phaseName}】${step.narrative || ""}</div>`);
    appendLog(
      `<div class="log-line">事件：${blue.short} <strong>${step.bEv.name}</strong>  vs  ${red.short} <strong>${step.rEv.name}</strong>（${step.edge}）</div>`
    );

    if (step.fight) {
      const fight = step.fight;
      for (const ev of fight.killFeed) {
        appendLog(`<div class="log-line kill">⚔ ${ev.text}</div>`);
      }
      const canvas = $("#battleCanvas");
      if (canvas) {
        if (state._anim) {
          state._anim.running = false;
        }
        state._anim = new S16.TeamfightAnim(canvas);
        state._anim.onLog = (msg) => appendLog(`<div class="log-line">${msg}</div>`);
        state._anim.onDone = () => {
          state.simIdx += 1;
          setTimeout(playNextStep, 350);
        };
        state._anim.start({
          winner: fight.winner,
          killsB: fight.killsB,
          killsR: fight.killsR,
          objective: fight.objective,
          blueName: blue.short,
          redName: red.short,
          skillBlue: fight.skillB,
          skillRed: fight.skillR,
          blueRoster: blue.roster,
          redRoster: red.roster,
          killFeed: fight.killFeed,
        });
      } else {
        state.simIdx += 1;
        setTimeout(playNextStep, 700);
      }
    } else {
      state.simIdx += 1;
      setTimeout(playNextStep, 700);
    }
  }

  function finishMatch() {
    const m = state.currentMatch;
    const result = state._pendingResult;
    if (!m || !result) return;
    applyResult(m, result);
    state._pendingResult = null;
    show("result");
  }

  function renderResult() {
    const r = state.lastResult;
    const banner = $("#resultBanner");
    const stats = $("#resultStats");
    const recap = $("#roundRecap");
    if (!r) return;
    const m = state.currentMatch;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const win = r.winner === "blue" ? blue : red;
    const lose = r.winner === "blue" ? red : blue;
    const iWin = win.id === state.myTeamId;

    if (banner) {
      banner.innerHTML = `
        <div class="result-kicker">${iWin ? "胜利" : "失利"} · ${r.marginText}</div>
        <h2>${win.name} 击败 ${lose.name}</h2>
        <p class="muted">${stageName(m.stage)} · 击杀 ${r.killsB} - ${r.killsR} · 预测 Top1 命中率 ${(r.predHitRate * 100).toFixed(0)}%</p>
      `;
      banner.className = "result-banner " + (iWin ? "win" : "lose");
    }
    if (stats) {
      stats.innerHTML = `
        <div class="stat-row"><span>蓝方</span><strong>${blue.short}</strong><span>${r.killsB} 击杀</span><span>资源 ${r.objsB}</span></div>
        <div class="stat-row"><span>红方</span><strong>${red.short}</strong><span>${r.killsR} 击杀</span><span>资源 ${r.objsR}</span></div>
        <div class="stat-row"><span>阵容</span><strong>${r.blueLineup.name}</strong><span>${r.blueStyle}</span></div>
        <div class="stat-row"><span>阵容</span><strong>${r.redLineup.name}</strong><span>${r.redStyle}</span></div>
      `;
    }
    if (recap) {
      recap.innerHTML = (r.rounds || [])
        .map(
          (step) => `
        <div class="recap-row">
          <strong>${step.phaseName}</strong>
          <span>${step.bEv.name} vs ${step.rEv.name}</span>
          <span class="muted">${step.fight ? `团战 ${step.fight.killsB}-${step.fight.killsR}` : "无团战"} · eco ${step.ecoB.toFixed(2)}/${step.ecoR.toFixed(2)}</span>
        </div>`
        )
        .join("");
    }

    const nextBtn = $("#btnResultNext");
    if (nextBtn) {
      nextBtn.onclick = () => {
        show("hub");
      };
    }
  }

  function renderChampion() {
    const box = $("#championBox");
    if (!box || !state.champion) return;
    const t = state.champion;
    box.innerHTML = `
      <div class="champion-kicker">S16 WORLD CHAMPION</div>
      ${t.logo ? `<img class="champion-logo" src="${t.logo}" alt="${t.short}" />` : ""}
      <h2>${t.name}</h2>
      <p class="muted">战力 ${t.power.toFixed(1)} · ${t.region}</p>
      <div class="champion-roster">
        ${t.roster
          .map(
            (p) => `
          <div class="champion-player">
            ${p.photo ? `<img src="${p.photo}" alt="${p.name}" />` : ""}
            <strong>${p.name}</strong>
            <span>${p.posCn}</span>
          </div>`
          )
          .join("")}
      </div>
      <button class="btn btn-primary" id="btnRestart">再战一届</button>
    `;
    const btn = $("#btnRestart");
    if (btn) btn.onclick = () => {
      initTournament();
      show("pick");
    };
  }

  function bind() {
    // nav
    $all("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        const nav = el.getAttribute("data-nav");
        if (nav === "doc") show("doc");
        else {
          if (!state.teams.length) initTournament();
          show(state.myTeamId ? "hub" : "pick");
        }
      });
    });

    const btnEnter = $("#btnEnter");
    if (btnEnter) {
      btnEnter.addEventListener("click", () => {
        initTournament();
        show("pick");
      });
    }

    const btnConfirmPick = $("#btnConfirmPick");
    if (btnConfirmPick) {
      btnConfirmPick.addEventListener("click", () => {
        if (!state.myTeamId) {
          alert("请先选择一支战队");
          return;
        }
        initTournament();
        show("hub");
      });
    }

    // dynamic clicks via delegation
    document.addEventListener("click", (e) => {
      const play = e.target.closest("[data-play-match]");
      if (play) {
        const id = play.getAttribute("data-play-match");
        const m = currentMatches().find((x) => x.id === id);
        if (m && !m.played) {
          state.currentMatch = m;
          state.prep = { lineup: "meta", style: (teamById(state.myTeamId) || {}).style || "engage" };
          show("prep");
        }
        return;
      }
      const sim = e.target.closest("[data-sim-match]");
      if (sim) {
        const id = sim.getAttribute("data-sim-match");
        const m = currentMatches().find((x) => x.id === id);
        if (m && !m.played) {
          simulateAndApply(m, true);
          renderHub();
        }
        return;
      }
      const simRest = e.target.closest("[data-sim-rest]");
      if (simRest) {
        currentMatches().forEach((m) => {
          if (!m.played) simulateAndApply(m, true);
        });
        renderHub();
        return;
      }
      const adv = e.target.closest("[data-advance]");
      if (adv) {
        const ok = advanceStage();
        if (!ok) {
          alert("请先打完当前阶段的比赛");
        } else if (state.stage === "done") {
          show("champion");
        } else {
          renderHub();
        }
        return;
      }
      const lineupBtn = e.target.closest("[data-lineup]");
      if (lineupBtn) {
        state.prep.lineup = lineupBtn.getAttribute("data-lineup");
        renderPrep();
        return;
      }
      const styleBtn = e.target.closest("[data-style]");
      if (styleBtn) {
        state.prep.style = styleBtn.getAttribute("data-style");
        renderPrep();
        return;
      }
    });

    const btnToStrategy = $("#btnToStrategy");
    if (btnToStrategy) {
      btnToStrategy.addEventListener("click", () => {
        startAutoMatch();
      });
    }

    const btnBattleNext = $("#btnBattleNext");
    if (btnBattleNext) {
      btnBattleNext.addEventListener("click", () => finishMatch());
    }
  }

  function init() {
    if (S16.applyRoster) S16.applyRoster();
    initTournament();
    bind();
    show("doc");
  }

  return { state, bind, show, init, applyResult, advanceStage, simulateAndApply, initTournament };
})();

document.addEventListener("DOMContentLoaded", () => {
  if (S16.applyRoster) S16.applyRoster();
  S16.Game.init();
});
