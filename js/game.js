/* Game flow, UI rendering, tournament progression */
window.S16 = window.S16 || {};

S16.Game = (() => {
  const state = {
    screen: "pick",
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
      el.classList.toggle("active", el.getAttribute("data-nav") === "game");
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
    // 唯一入口：computeSeriesScore
    const games = Array.isArray(result && result.games) ? result.games : [result].filter(Boolean);
    const score = computeSeriesScore(match, games);
    const isSeries = result.mode === "BO5" || Array.isArray(result.games);
    let winner = score.winner || result.winner;
    let winnerTeamId = score.winnerTeamId || result.winnerTeamId;
    let winsB = score.winsB;
    let winsR = score.winsR;
    if (!isSeries && games.length === 1) {
      const wid = gameWinTeamId(games[0]) || winnerTeamId;
      winsB = wid === match.blue ? 1 : 0;
      winsR = wid === match.red ? 1 : 0;
      winnerTeamId = wid;
      winner = wid === match.blue ? "blue" : "red";
    }
    if (winner === "blue" && !winnerTeamId) winnerTeamId = match.blue;
    if (winner === "red" && !winnerTeamId) winnerTeamId = match.red;
    const killsB = games.reduce((s, g) => s + (g.killsB || 0), 0);
    const killsR = games.reduce((s, g) => s + (g.killsR || 0), 0);

    match.played = true;
    match.result = {
      winner,
      winnerTeamId,
      loserTeamId: winner === "blue" ? match.red : match.blue,
      mode: "BO5",
      winsB,
      winsR,
      scoreB: winsB,
      scoreR: winsR,
      scoreLeft: score.scoreLeft,
      scoreRight: score.scoreRight,
      leftTeamId: score.leftTeamId,
      rightTeamId: score.rightTeamId,
      killsB,
      killsR,
      marginText: isSeries ? "团灭决胜" : result.marginText || "团灭决胜",
      wipeEnd: true,
    };
    const winId = winnerTeamId;
    const loseId = winId === match.blue ? match.red : match.blue;
    if (state.standings[winId]) {
      state.standings[winId].pts += 3;
      state.standings[winId].win += 1;
    }
    if (state.standings[loseId]) state.standings[loseId].loss += 1;
    if (state.standings[match.blue]) {
      state.standings[match.blue].kills += killsB;
      state.standings[match.blue].deaths += killsR;
    }
    if (state.standings[match.red]) {
      state.standings[match.red].kills += killsR;
      state.standings[match.red].deaths += killsB;
    }
    state.lastResult = {
      matchId: match.id,
      ...result,
      winner,
      winnerTeamId,
      killsB,
      killsR,
      winsB,
      winsR,
      scoreLeft: score.scoreLeft,
      scoreRight: score.scoreRight,
      leftTeamId: score.leftTeamId,
      rightTeamId: score.rightTeamId,
      wins: score.wins,
    };
  }

  function simulateAndApply(match, silent) {
    const blue = teamById(match.blue);
    const red = teamById(match.red);
    const bp = S16.Engine.autoPicks(blue);
    const rp = S16.Engine.autoPicks(red);
    const result = S16.Engine.simulateSeries({
      blue,
      red,
      blueLineup: bp.lineup,
      redLineup: rp.lineup,
      blueStyle: bp.style,
      redStyle: rp.style,
    });
    applyResult(match, result);
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
            <span class="standings-team ${r.loss > 0 ? "name-defeated" : ""}">${(teamById(r.id) || {}).short || r.id}</span>
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
          const blueLost = m.played && m.result && m.result.winner === "red";
          const redLost = m.played && m.result && m.result.winner === "blue";
          return `
          <div class="match-card ${isMine ? "mine" : ""} ${m.played ? "played" : ""}">
            <div class="match-card-stage">${stageName(m.stage)}</div>
            <div class="match-row"><span class="${blueLost ? "name-defeated" : ""}">${b ? b.short : m.blue}</span><strong>${m.played && m.result ? (m.result.winner === "blue" ? "胜" : "负") : "—"}</strong></div>
            <div class="match-row"><span class="${redLost ? "name-defeated" : ""}">${r ? r.short : m.red}</span><strong>${m.played && m.result ? (m.result.winner === "red" ? "胜" : "负") : "—"}</strong></div>
            ${m.played && m.result ? `<div class="match-score">BO5 ${m.result.scoreLeft ?? m.result.winsB ?? 0}-${m.result.scoreRight ?? m.result.winsR ?? 0}</div>` : ""}
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
        <button class="btn" data-redraw="1">重新抽签</button>
        <button class="btn" data-sim-rest="1">模拟剩余全部</button>
        <button class="btn btn-ghost" data-advance="1">推进阶段</button>
      `;
    }
  }

  function renderPrep() {
    const m = state.currentMatch;
    if (!m) return;
    const strategyBtn = $("#btnToStrategy");
    if (strategyBtn) {
      strategyBtn.textContent = state._midSeries ? "继续 BO5 · 用新战术打完剩余局" : "开始推演观战";
    }
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

    const strategyBtn2 = $("#btnToStrategy");
    if (strategyBtn2) strategyBtn2.disabled = false;
  }

  function gameWinTeamId(g) {
    if (!g) return null;
    if (g.winnerTeamId) return g.winnerTeamId;
    const m = state.currentMatch;
    if (!m) return null;
    if (g.winner === "blue") return m.blue;
    if (g.winner === "red") return m.red;
    return null;
  }

  /**
   * 唯一局分算法：按战队 id 统计 games 的胜场。
   * 所有界面（对战横幅 / 总览 / 赛果）都必须走这里。
   */
  function computeSeriesScore(match, games) {
    const wins = {};
    (games || []).forEach((g) => {
      const id = gameWinTeamId(g);
      if (id) wins[id] = (wins[id] || 0) + 1;
    });
    const winsB = match ? wins[match.blue] || 0 : 0;
    const winsR = match ? wins[match.red] || 0 : 0;
    let winner = null;
    let winnerTeamId = null;
    if (match) {
      if (winsB >= 3) {
        winner = "blue";
        winnerTeamId = match.blue;
      } else if (winsR >= 3) {
        winner = "red";
        winnerTeamId = match.red;
      } else if ((games || []).length) {
        winnerTeamId = winsB >= winsR ? match.blue : match.red;
        winner = winnerTeamId === match.blue ? "blue" : "red";
      }
    }
    const playerIsBlue = match && state.myTeamId ? match.blue === state.myTeamId : true;
    const leftTeamId = match
      ? playerIsBlue
        ? match.blue
        : match.red
      : null;
    const rightTeamId = match
      ? playerIsBlue
        ? match.red
        : match.blue
      : null;
    return {
      wins,
      winsB,
      winsR,
      winner,
      winnerTeamId,
      playerIsBlue,
      leftTeamId,
      rightTeamId,
      scoreLeft: (leftTeamId && wins[leftTeamId]) || 0,
      scoreRight: (rightTeamId && wins[rightTeamId]) || 0,
      gamesCount: (games || []).length,
    };
  }

  function seriesResultFromGames(games) {
    return computeSeriesScore(state.currentMatch, games);
  }

  function countSeriesWins(games) {
    return computeSeriesScore(state.currentMatch, games).wins;
  }

  function renderBo1ScoreBanner() {
    const box = $("#bo1ScoreBanner");
    if (!box) return;
    // 动画未结束绝不显示局分
    const animBusy = state._anim && (state._anim.running || !state._anim._doneFired);
    if (!state._midSeries || animBusy) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const st = state._seriesState;
    const m = state.currentMatch;
    if (!st || !m || !st.games || !st.games.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const score = computeSeriesScore(m, st.games);
    st.winsB = score.winsB;
    st.winsR = score.winsR;
    st.winsByTeam = score.wins;

    const leftTeam = teamById(score.leftTeamId) || blue;
    const rightTeam = teamById(score.rightTeamId) || red;
    const g = st.games[st.games.length - 1];
    const leftWonLast = g && gameWinTeamId(g) === score.leftTeamId;
    box.hidden = false;
    box.innerHTML = `
      <div class="bo1-score-side">
        ${leftTeam && leftTeam.logo ? `<img src="${leftTeam.logo}" alt="${leftTeam.short}" />` : ""}
        <div class="bo1-score-name">${leftTeam ? leftTeam.name : m.blue}</div>
        <div class="bo1-score-num ${leftWonLast ? "win" : "lose"}">${score.scoreLeft}</div>
      </div>
      <div class="bo1-score-mid">
        <div class="bo1-score-main">${score.scoreLeft}:${score.scoreRight}</div>
        <div class="bo1-score-sub">BO5 先胜 3 · 已打 ${score.gamesCount} 局</div>
      </div>
      <div class="bo1-score-side">
        ${rightTeam && rightTeam.logo ? `<img src="${rightTeam.logo}" alt="${rightTeam.short}" />` : ""}
        <div class="bo1-score-name">${rightTeam ? rightTeam.name : m.red}</div>
        <div class="bo1-score-num ${!leftWonLast && g ? "win" : "lose"}">${score.scoreRight}</div>
      </div>
    `;
  }

  function renderBattleShell() {
    const m = state.currentMatch;
    if (!m) return;
    const cbox = $("#commentaryBox");
    if (cbox) cbox.innerHTML = "";
    const banner = $("#bo1ScoreBanner");
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const phaseNow = $("#phaseNow");
    if (phaseNow) phaseNow.innerHTML = `<h3>推演观战</h3><p class="muted">${blue.short} vs ${red.short} · 程序自主推演</p>`;
    const log = $("#battleLog");
    if (log) log.innerHTML = "";
    const nextBtn = $("#btnBattleNext");
    if (nextBtn) nextBtn.disabled = true;
  }

  function buildSeriesInput(extra) {
    const m = state.currentMatch;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const myIsBlue = m.blue === state.myTeamId;
    return {
      blue,
      red,
      blueLineup: myIsBlue ? state.prep.lineup : S16.Engine.autoLineup(blue),
      redLineup: myIsBlue ? S16.Engine.autoLineup(red) : state.prep.lineup,
      blueStyle: myIsBlue ? state.prep.style : (blue.style || S16.Engine.autoPicks(blue).style),
      redStyle: myIsBlue ? (red.style || S16.Engine.autoPicks(red).style) : state.prep.style,
      ...extra,
    };
  }

  function finishSeriesFromState() {
    const st = state._seriesState;
    if (!st) return null;
    const input = buildSeriesInput();
    const m = state.currentMatch;
    const games = st.games.slice();
    let s = seriesResultFromGames(games);
    while (s.winsB < 3 && s.winsR < 3 && games.length < 5) {
      const g = S16.Engine.simulateMatch(input);
      games.push(g);
      s = seriesResultFromGames(games);
    }
    st.winsB = s.winsB;
    st.winsR = s.winsR;
    st.games = games;
    return {
      mode: "BO5",
      winsB: s.winsB,
      winsR: s.winsR,
      winner: s.winner,
      winnerTeamId: s.winnerTeamId,
      games,
      animatedGameIndex: 0,
      animatedGame: games[0] || null,
    };
  }

  /** 用当前战术再打一局 BO1，并留在对战画面回放 */
  function playNextGameInSeries(opts) {
    const fromTactics = !!(opts && opts.fromTactics);
    const st = state._seriesState;
    if (!st) {
      startAutoMatch();
      return;
    }
    if (st.winsB >= 3 || st.winsR >= 3 || st.games.length >= 5) {
      const series = finishSeriesFromState();
      state._pendingSeries = series;
      finishMatch();
      return;
    }
    const input = buildSeriesInput();
    const game = S16.Engine.simulateMatch(input);
    st.games.push(game);
    const m = state.currentMatch;
    const sw = seriesResultFromGames(st.games);
    st.winsB = sw.winsB;
    st.winsR = sw.winsR;
    state._pendingSeries = null;
    state._pendingResult = game;
    state.simIdx = 0;
    state._liveBuffs = { blue: [], red: [] };
    state._midSeries = false;
    state._animDone = false;
    state._commentCount = 0;
    state._playErr = 0;
    // 杀掉上一局动画，避免旧 onDone 把第二局提前结束
    if (state._anim) {
      state._anim.running = false;
      state._anim._doneFired = true;
      state._anim.onDone = null;
      state._anim = null;
    }
    if (state._predTimer) {
      clearInterval(state._predTimer);
      state._predTimer = null;
    }
    show("battle");
    const log = $("#battleLog");
    if (log) log.innerHTML = "";
    const cbox = $("#commentaryBox");
    if (cbox) cbox.innerHTML = "";
    // 对局动画进行中：先隐藏局分，结束后再显示
    const banner = $("#bo1ScoreBanner");
    if (banner) {
      banner.hidden = true;
      banner.innerHTML = "";
    }
    appendLog(
      `<div class="log-line done">BO5 进行中 · 当前 ${st.winsB}-${st.winsR} · 播放第 ${st.games.length} 局 BO1（${fromTactics ? "新战术生效" : "沿用当前战术"}）</div>`
    );
    const btnNext = $("#btnBattleNext");
    const btnAdjust = $("#btnAdjustTactics");
    const btnNextGame = $("#btnNextGame");
    if (btnNext) btnNext.disabled = true;
    if (btnAdjust) btnAdjust.hidden = true;
    if (btnNextGame) btnNextGame.hidden = true;
    startBattleWatchdog();
    playNextStep();
  }

  function startBattleWatchdog() {
    if (state._watchdog) clearInterval(state._watchdog);
    let lastIdx = -1;
    let stalls = 0;
    state._watchdog = setInterval(() => {
      if (state.screen !== "battle" || state._midSeries) {
        clearInterval(state._watchdog);
        state._watchdog = null;
        return;
      }
      // 动画仍在播：不要因为 simIdx 未变而判定卡死
      if (state._anim && state._anim.running) {
        lastIdx = state.simIdx;
        stalls = 0;
        return;
      }
      if (state.simIdx === lastIdx) {
        stalls += 1;
        // 仅在动画未运行时兜底推进（避免对局 UI 早于动画结束）
        if (stalls >= 4) {
          if (state._anim && !state._anim.running) {
            if (!state._anim._doneFired) {
              state._anim._doneFired = true;
              try {
                if (state._anim.onDone) state._anim.onDone();
              } catch (e) {
                state.simIdx += 1;
                setTimeout(playNextStep, 100);
              }
            } else if (state.simIdx < ((state._pendingResult && state._pendingResult.rounds) || []).length) {
              state.simIdx += 1;
              setTimeout(playNextStep, 100);
            }
          } else if (!state._anim) {
            state.simIdx += 1;
            setTimeout(playNextStep, 100);
          }
          stalls = 0;
        }
      } else {
        lastIdx = state.simIdx;
        stalls = 0;
      }
    }, 4000);
  }

  function startAutoMatch() {
    const m = state.currentMatch;
    if (!m) return;
    const input = buildSeriesInput();
    // 先打第 1 局 BO1（动画）；结束后可改战术或看完整 BO5
    const game1 = S16.Engine.simulateMatch(input);
    const w1 = gameWinTeamId(game1);
    state._seriesState = {
      winsB: w1 && w1 === m.blue ? 1 : 0,
      winsR: w1 && w1 === m.red ? 1 : 0,
      games: [game1],
      input,
    };
    state._pendingSeries = null;
    state._pendingResult = game1;
    state.simIdx = 0;
    state._liveBuffs = { blue: [], red: [] };
    state._midSeries = false;
    state._animDone = false;
    state._commentCount = 0;
    state._playErr = 0;
    if (state._anim) {
      state._anim.running = false;
      state._anim._doneFired = true;
      state._anim.onDone = null;
      state._anim = null;
    }
    if (state._predTimer) {
      clearInterval(state._predTimer);
      state._predTimer = null;
    }
    show("battle");
    const banner0 = $("#bo1ScoreBanner");
    if (banner0) {
      banner0.hidden = true;
      banner0.innerHTML = "";
    }
    appendLog(
      `<div class="log-line done">BO5 · 先胜 3 局 · 动画播放第 1 局 BO1（加速进行，一方全员阵亡即结束）</div>`
    );
    const btnNext = $("#btnBattleNext");
    const btnAdjust = $("#btnAdjustTactics");
    const btnNextGame = $("#btnNextGame");
    if (btnNext) btnNext.disabled = true;
    if (btnAdjust) btnAdjust.hidden = true;
    if (btnNextGame) btnNextGame.hidden = true;
    startBattleWatchdog();
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

  /** 稀疏解说：每局 BO1 最多 2 条，关键节点概率触发 */
  function maybeCommentary(kind, ctx) {
    if (!state._commentCount) state._commentCount = 0;
    if (state._commentCount >= 2) return;
    const bag = (S16.COMMENTARY && S16.COMMENTARY[kind]) || [];
    if (!bag.length) return;
    // 不要过于频繁：基础 28%，wipe/steal 略高
    const p = kind === "wipe" || kind === "steal" ? 0.42 : 0.28;
    if (Math.random() > p) return;
    const line = bag[Math.floor(Math.random() * bag.length)];
    const m = state.currentMatch;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    const myIsBlue = m.blue === state.myTeamId;
    const team = (ctx && ctx.team) || (myIsBlue ? blue : red);
    const foe = (ctx && ctx.foe) || (myIsBlue ? red : blue);
    const roster = (team && team.roster) || [];
    const foeRoster = (foe && foe.roster) || [];
    const p1 =
      (ctx && ctx.p1) ||
      roster[Math.floor(Math.random() * roster.length)]?.name ||
      "选手";
    const p2 = foeRoster[Math.floor(Math.random() * foeRoster.length)]?.name || "对面";
    const obj =
      (ctx && ctx.obj) ||
      (kind === "steal" || kind === "buff" ? "大龙" : "资源点");
    const text = line
      .split("{p1}").join(p1)
      .split("{p2}").join(p2)
      .split("{team}").join(team ? team.short || team.name : "我方")
      .split("{foe}").join(foe ? foe.short || foe.name : "对方")
      .split("{obj}").join(obj);
    state._commentCount += 1;
    const box = $("#commentaryBox");
    if (box) {
      const div = document.createElement("div");
      div.className = "commentary-line";
      div.textContent = `🎙 ${text}`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    } else {
      appendLog(`<div class="log-line commentary">🎙 ${text}</div>`);
    }
  }

  function renderPredPanel(step, liveNote) {
    const predPanel = $("#predPanel");
    if (!predPanel || !step) return;
    const top = step.predB || [];
    predPanel.innerHTML = `
      <div class="pred-title">战况推演</div>
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

  function playNextStep() {
    try {
      playNextStepInner();
      state._playErr = 0;
    } catch (err) {
      console.error("playNextStep failed", err);
      state._playErr = (state._playErr || 0) + 1;
      appendLog(`<div class="log-line">⚠ 推演出错，自动推进中…</div>`);
      if (state._playErr > 5) {
        appendLog(`<div class="log-line">⚠ 错误次数过多，跳过本局推演</div>`);
        // 动画若仍在播，等 onDone 后再亮局分
        if (state._anim && (state._anim.running || !state._anim._doneFired)) {
          state._anim.running = false;
          if (!state._anim._doneFired) {
            state._anim._doneFired = true;
            try {
              if (state._anim.onDone) state._anim.onDone();
            } catch (e) {}
          }
          return;
        }
        state._midSeries = true;
        renderBo1ScoreBanner();
        const nextBtn = $("#btnBattleNext");
        if (nextBtn) nextBtn.disabled = false;
        return;
      }
      const total = state._pendingResult && state._pendingResult.rounds
        ? state._pendingResult.rounds.length
        : 0;
      if (total && state.simIdx >= total - 1) {
        state.simIdx = total;
        setTimeout(playNextStep, 80);
        return;
      }
      state.simIdx += 1;
      setTimeout(playNextStep, 200);
    }
  }

  function playNextStepInner() {
    const result = state._pendingResult;
    if (!result) {
      appendLog(`<div class="log-line">⚠ 无对局数据，返回总览</div>`);
      setTimeout(() => show("hub"), 400);
      return;
    }
    if (!Array.isArray(result.rounds)) result.rounds = [];
    // 动画未播完不进入结算 UI（含击杀播报未播完）
    if (state._anim && (state._anim.running || !state._anim._doneFired)) {
      return;
    }
    const m = state.currentMatch;
    const blue = m ? teamById(m.blue) : null;
    const red = m ? teamById(m.red) : null;
    if (state.simIdx >= result.rounds.length) {
      // 仅当动画已结束才亮局分
      state._midSeries = true;
      state._animDone = true;
      renderBo1ScoreBanner();
      const st = state._seriesState || { winsB: 0, winsR: 0, games: [] };
      const seriesDone = st.winsB >= 3 || st.winsR >= 3 || st.games.length >= 5;
      const nextBtn = $("#btnBattleNext");
      const btnAdjust = $("#btnAdjustTactics");
      const btnNextGame = $("#btnNextGame");
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = "查看 BO5 结果";
        nextBtn.onclick = () => {
          const series = finishSeriesFromState();
          state._pendingSeries = series;
          finishMatch();
        };
      }
      if (btnAdjust) {
        btnAdjust.hidden = seriesDone;
        btnAdjust.textContent = "调整战术 · 打下一局";
        btnAdjust.onclick = () => show("prep");
      }
      if (btnNextGame) {
        btnNextGame.hidden = seriesDone;
        btnNextGame.textContent = "直接开始下一局";
        btnNextGame.onclick = () => playNextGameInSeries({ fromTactics: false });
      }
      const lastG = (st.games || [])[st.games.length - 1];
      const lastWinnerTeam =
        lastG && m && lastG.winnerTeamId === m.blue
          ? (blue && blue.short) || "蓝方"
          : lastG && m && lastG.winnerTeamId === m.red
            ? (red && red.short) || "红方"
            : lastG && lastG.winner === "blue"
              ? (blue && blue.short) || "蓝方"
              : (red && red.short) || "红方";
      const sc = computeSeriesScore(m, st.games || []);
      const scoreText = `${sc.scoreLeft}-${sc.scoreRight}`;
      appendLog(
        seriesDone
          ? `<div class="log-line done">BO5 已分胜负（${scoreText}）· 可查看完整 BO5 结果</div>`
          : `<div class="log-line done">本局胜者：<strong>${lastWinnerTeam}</strong> · 局分 ${scoreText} · 可直接开始下一局或查看 BO5 结果</div>`
      );
      return;
    }

    const step = result.rounds[state.simIdx];

    renderPredPanel(step);

    const phaseNow = $("#phaseNow");
    if (phaseNow) {
      const live = state._liveBuffs || { blue: [], red: [] };
      const chip = (b) =>
        `<span class="buff-chip" style="--buff:${b.color || "#c8aa6e"}">${b.icon} ${b.name}</span>`;
      phaseNow.innerHTML = `
        <h3>${step.phaseName}</h3>
        <div class="phase-reveal">
          <div class="ev blue">${blue.short} · <strong>${step.bEv.name}</strong> <em>${step.bEv.desc}</em></div>
          <div class="ev red">${red.short} · <strong>${step.rEv.name}</strong> <em>${step.rEv.desc}</em></div>
          <div class="edge">克制结果：<strong>${step.edge === "a" ? blue.short + " 占优" : step.edge === "b" ? red.short + " 占优" : step.edge === "mirror" ? "镜像" : "均势"}</strong>${step.force ? " · 经济差强行接团" : ""}</div>
          <div class="buff-list">
            <span class="muted">${blue.short}</span> ${live.blue.map(chip).join("") || '<span class="muted">无</span>'}
            &nbsp;·&nbsp;
            <span class="muted">${red.short}</span> ${live.red.map(chip).join("") || '<span class="muted">无</span>'}
          </div>
        </div>
      `;
    }

    appendLog(`<div class="log-line">【${step.phaseName}】${step.narrative || ""}</div>`);
    appendLog(
      `<div class="log-line">事件：${blue.short} <strong>${step.bEv.name}</strong>  vs  ${red.short} <strong>${step.rEv.name}</strong>（${step.edge}）</div>`
    );

    if (step.fight) {
      const fight = step.fight;
      // 击杀播报由动画按时间轴同步输出，避免日志先于画面结束
      appendLog(
        `<div class="log-line">⚔ 接团开始 · 预计击杀 ${fight.killsB}-${fight.killsR} · 途中小龙/大龙随机结算</div>`
      );
      maybeCommentary("engage", {
        obj: "资源点",
      });
      const live = state._liveBuffs || { blue: [], red: [] };
      const canvas = $("#battleCanvas");
      const nextBtn = $("#btnBattleNext");
      if (nextBtn) nextBtn.disabled = true;
      if (canvas) {
        if (state._anim) {
          state._anim.running = false;
          state._anim._doneFired = true;
        }
        state._anim = new S16.TeamfightAnim(canvas);
        state._anim.onLog = (msg) => appendLog(`<div class="log-line">${msg}</div>`);
        // 团战中持续刷新预测面板，避免长时间不更新
        if (state._predTimer) clearInterval(state._predTimer);
        let predFlip = 0;
        state._predTimer = setInterval(() => {
          if (state._midSeries || state.screen !== "battle") {
            clearInterval(state._predTimer);
            state._predTimer = null;
            return;
          }
          predFlip += 1;
          // 轻微扰动展示，保持面板“在动”
          const cloned = {
            ...step,
            predB: (step.predB || []).map((row, idx) => ({
              ...row,
              prob: Math.max(0.05, Math.min(0.9, row.prob + Math.sin(predFlip + idx) * 0.03)),
            })),
          };
          const s = cloned.predB.reduce((a, r) => a + r.prob, 0) || 1;
          cloned.predB = cloned.predB.map((r) => ({ ...r, prob: r.prob / s }));
          renderPredPanel(cloned);
        }, 700);
        state._anim.onBuff = (buff) => {
          const bag = buff.winner === "blue" ? live.blue : live.red;
          bag.push({ ...buff, side: buff.winner });
          state._liveBuffs = live;
          appendLog(
            `<div class="log-line">◈ ${buff.winner === "blue" ? blue.short : red.short} 获得 ${buff.icon} ${buff.name}</div>`
          );
          if (buff.id === "baron" || buff.id === "dragon") {
            maybeCommentary("steal", {
              team: buff.winner === "blue" ? blue : red,
              foe: buff.winner === "blue" ? red : blue,
              obj: buff.id === "baron" ? "大龙" : "小龙",
            });
          }
        };
        state._anim.onDone = () => {
          if (state._predTimer) {
            clearInterval(state._predTimer);
            state._predTimer = null;
          }
          try {
            maybeCommentary("wipe", {});
            maybeCommentary(Math.random() < 0.55 ? "turn" : "misc", {});
          } catch (e) {
            console.error("commentary failed", e);
          }
          // 动画完全结束后再进入结算（显示局分）
          state._animDone = true;
          state.simIdx += 1;
          setTimeout(playNextStep, 80);
        };
        state._anim.start({
          winner: fight.winner,
          wipeSide: fight.wiped,
          winnerTeamId: fight.winnerTeamId,
          wipedTeamId: fight.wipedTeamId,
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
          timelineBuffs: fight.timelineBuffs || [],
          buffsBlue: live.blue.slice(),
          buffsRed: live.red.slice(),
        });
      } else {
        // no canvas: stream kill feed with pacing so log still matches timeline
        fight.killFeed.forEach((ev, i) => {
          setTimeout(() => {
            appendLog(`<div class="log-line kill">⚔ ${ev.text}</div>`);
            if (i === fight.killFeed.length - 1) {
              if (fight.buff) {
                const bag = fight.buff.winner === "blue" ? live.blue : live.red;
                bag.push(fight.buff);
                state._liveBuffs = live;
              }
              state.simIdx += 1;
              setTimeout(playNextStep, 120);
            }
          }, 700 + i * 900);
        });
        if (!fight.killFeed.length) {
          if (fight.buff) {
            const bag = fight.buff.winner === "blue" ? live.blue : live.red;
            bag.push(fight.buff);
            state._liveBuffs = live;
          }
          state.simIdx += 1;
          setTimeout(playNextStep, 100);
        }
      }
    } else {
      state.simIdx += 1;
      setTimeout(playNextStep, 120);
    }
  }

  function autoSimRestOfStage() {
    // 比赛结束后自动模拟剩余全部（玩家未开打的亲征场除外）
    const minePending = nextPlayerMatch();
    currentMatches().forEach((m) => {
      if (m.played) return;
      const isMine = m.blue === state.myTeamId || m.red === state.myTeamId;
      if (isMine && minePending && minePending.id === m.id) return;
      simulateAndApply(m, true);
    });
    renderHub();
  }

  function finishMatch() {
    const m = state.currentMatch;
    const series = state._pendingSeries;
    const game = state._pendingResult;
    if (!m || (!series && !game)) return;
    applyResult(m, series || game);
    state._pendingSeries = null;
    state._pendingResult = null;
    state._seriesState = null;
    state._midSeries = false;
    autoSimRestOfStage();
    show("result");
  }

  function renderResult() {
    const r = state.lastResult;
    const banner = $("#resultBanner");
    const stats = $("#resultStats");
    const recap = $("#roundRecap");
    const nextBtn = $("#btnResultNext");
    // always wire the back button, even if result rendering fails
    if (nextBtn) {
      nextBtn.onclick = () => show("hub");
      nextBtn.disabled = false;
    }
    if (!r || !state.currentMatch) return;
    const m = state.currentMatch;
    const blue = teamById(m.blue);
    const red = teamById(m.red);
    if (!blue || !red) {
      show("hub");
      return;
    }
    // 与对战/总览同一套：只读 match.result（applyResult 写入）
    const res = m.result || r;
    const playerTeam = (state.myTeamId && teamById(state.myTeamId)) || blue;
    const oppTeam = playerTeam && playerTeam.id === red.id ? blue : red;
    const playerIsBlue = playerTeam && playerTeam.id === m.blue;
    let playerWins = playerIsBlue ? res.winsB || 0 : res.winsR || 0;
    let oppWins = playerIsBlue ? res.winsR || 0 : res.winsB || 0;
    if (res.scoreLeft != null && res.scoreRight != null) {
      playerWins = res.scoreLeft;
      oppWins = res.scoreRight;
    }
    const winId = res.winnerTeamId || r.winnerTeamId;
    const win = teamById(winId) || (r.winner === "blue" ? blue : red);
    const lose = win && win.id === blue.id ? red : blue;
    const iWin = win && win.id === state.myTeamId;
    // BO5 series may not carry lineup at top-level — fall back to animated game
    const sampleGame = r.animatedGame || (r.games && r.games[0]) || r;
    const blueLineupName = (sampleGame.blueLineup && sampleGame.blueLineup.name) || "—";
    const redLineupName = (sampleGame.redLineup && sampleGame.redLineup.name) || "—";
    const blueStyle = sampleGame.blueStyle || blue.style || "—";
    const redStyle = sampleGame.redStyle || red.style || "—";
    const rounds = sampleGame.rounds || r.rounds || [];

    if (banner) {
      banner.innerHTML = `
        <div class="result-kicker">${iWin ? "胜利" : "失利"} · BO5 ${playerWins}-${oppWins}</div>
        <h2>${win.name} 击败 ${lose.name}</h2>
        <p class="muted">${stageName(m.stage)} · 系列赛先胜 3 局 · 总击杀 ${r.killsB || 0} - ${r.killsR || 0} · 胜负标准：一方全员阵亡</p>
      `;
      banner.className = "result-banner " + (iWin ? "win" : "lose");
    }
    if (stats) {
      const buffChip = (b) =>
        `<span class="buff-chip" style="--buff:${b.color || "#c8aa6e"}">${b.icon} ${b.name}</span>`;
      const buffsB = (sampleGame.buffsBlue || r.buffsBlue || []).map(buffChip).join("") || `<span class="muted">无</span>`;
      const buffsR = (sampleGame.buffsRed || r.buffsRed || []).map(buffChip).join("") || `<span class="muted">无</span>`;
      stats.innerHTML = `
        <div class="stat-row"><span>赛制</span><strong>BO5</strong><span>先胜 3 局</span><span>动画仅播 1 局 BO1</span></div>
        <div class="stat-row"><span>局分</span><strong>${playerTeam ? playerTeam.short : blue.short} ${playerWins}</strong><span>${oppWins} ${oppTeam ? oppTeam.short : red.short}</span><span>团灭决胜</span></div>
        <div class="stat-row"><span>击杀</span><strong>${blue.short}</strong><span>${r.killsB || 0}</span><span>—</span></div>
        <div class="stat-row"><span>击杀</span><strong>${red.short}</strong><span>${r.killsR || 0}</span><span>—</span></div>
        <div class="stat-row"><span>阵容</span><strong>${blueLineupName}</strong><span>${blueStyle}</span></div>
        <div class="stat-row"><span>阵容</span><strong>${redLineupName}</strong><span>${redStyle}</span></div>
        <div class="stat-row"><span>Buff</span><strong>${blue.short}</strong><span class="buff-list">${buffsB}</span></div>
        <div class="stat-row"><span>Buff</span><strong>${red.short}</strong><span class="buff-list">${buffsR}</span></div>
      `;
    }
    if (recap) {
      recap.innerHTML = rounds
        .map(
          (step) => `
        <div class="recap-row">
          <strong>${step.phaseName || step.phase || ""}</strong>
          <span>${(step.bEv && step.bEv.name) || ""} vs ${(step.rEv && step.rEv.name) || ""}</span>
          <span class="muted">${step.fight ? `团战 ${step.fight.killsB}-${step.fight.killsR}` : "无团战"}</span>
        </div>`
        )
        .join("");
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
      const redraw = e.target.closest("[data-redraw]");
      if (redraw) {
        // 仅积分赛开打前可重新抽签
        const canRedraw =
          state.stage === "group" &&
          state.groupMatches.every((m) => !m.played);
        if (!canRedraw) {
          alert("已有比赛完成，无法重新抽签");
          return;
        }
        initTournament();
        // 保留已选主队
        renderHub();
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
      btnToStrategy.onclick = () => {
        if (state._midSeries) {
          playNextGameInSeries({ fromTactics: true });
        } else {
          startAutoMatch();
        }
      };
    }

    const btnBattleNext = $("#btnBattleNext");
    if (btnBattleNext) {
      btnBattleNext.onclick = () => {
        if (state._midSeries) {
          const series = finishSeriesFromState();
          state._pendingSeries = series;
          finishMatch();
        } else {
          finishMatch();
        }
      };
    }

    const btnAdjust = $("#btnAdjustTactics");
    if (btnAdjust) {
      btnAdjust.onclick = () => {
        show("prep");
      };
    }

    const btnNextGame = $("#btnNextGame");
    if (btnNextGame) {
      btnNextGame.onclick = () => {
        playNextGameInSeries({ fromTactics: false });
      };
    }

    const btnResultNext = $("#btnResultNext");
    if (btnResultNext) {
      btnResultNext.addEventListener("click", () => show("hub"));
    }
  }

  function init() {
    if (S16.applyRoster) S16.applyRoster();
    initTournament();
    bind();
    show("pick");
  }

  return { state, bind, show, init, applyResult, advanceStage, simulateAndApply, initTournament };
})();

document.addEventListener("DOMContentLoaded", () => {
  if (S16.applyRoster) S16.applyRoster();
  S16.Game.init();
});
