/* S16 battle engine: prediction, simulation, kill feed */
window.S16 = window.S16 || {};

S16.Engine = (() => {
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp(lo, hi, v) {
    return Math.max(lo, Math.min(hi, v));
  }

  function softmax(scores, temp = 1.15) {
    const max = Math.max(...scores);
    const exps = scores.map((s) => Math.exp((s - max) / temp));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    return exps.map((e) => e / sum);
  }

  function sample(probs) {
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < probs.length; i++) {
      acc += probs[i];
      if (r <= acc) return i;
    }
    return probs.length - 1;
  }

  function resolveLineup(team, lineupId) {
    const lineup = (S16.LINEUPS || []).find((l) => l.id === lineupId) || S16.LINEUPS[0];
    let mod = 1 + (lineup.bonus || 0);
    let skill = null;
    if (lineupId === "signature") {
      const linked = 3 + Math.max(0, ((team.heroes || []).length - 1));
      const peak = 0.08 + linked / 100 + rand(0, 0.03);
      mod = 1 + peak;
      skill = S16.HERO_SKILLS && S16.HERO_SKILLS.focus;
    } else if (lineupId === "offmeta") {
      const roll = Math.random();
      if (roll < 0.3) {
        mod = 1.2;
        skill = S16.HERO_SKILLS && S16.HERO_SKILLS.steal;
      } else if (roll < 0.7) {
        mod = 1.0;
      } else {
        mod = 0.9;
      }
    } else {
      skill = S16.HERO_SKILLS && S16.HERO_SKILLS.harvest;
    }
    return { mod, skill, lineupId, name: lineup.name };
  }

  function styleEdge(myStyle, foeStyle) {
    if (!myStyle || !foeStyle) return 1;
    const ns = S16.normalizeStyle || ((s) => s);
    myStyle = ns(myStyle);
    foeStyle = ns(foeStyle);
    const counter = S16.STYLE_COUNTER || {};
    if (counter[myStyle] === foeStyle) return 1.08;
    if (counter[foeStyle] === myStyle) return 0.93;
    return 1.0;
  }

  function counterEdge(aId, bId, phase) {
    if (!aId || !bId) return "none";
    const phaseDef = (S16.PHASES || []).find((p) => p.id === phase);
    if (!phaseDef) return "none";
    const map = {};
    for (const c of phaseDef.cards) map[c.id] = c.beats;
    if (aId === bId) return "mirror";
    if (map[aId] === bId) return "a";
    if (map[bId] === aId) return "b";
    return "none";
  }

  function styleEventWeight(style, evId) {
    const ns = S16.normalizeStyle || ((s) => s);
    style = ns(style);
    const w = {
      engage: { invade: 0.35, ambush: 0.2, lane: -0.1, rush: 0.3, wrap: 0.15, camp: -0.05 },
      protect: { invade: -0.15, ambush: 0.1, lane: 0.35, rush: -0.05, wrap: -0.1, camp: 0.3 },
      split: { invade: 0.2, ambush: -0.05, lane: 0.15, rush: -0.1, wrap: 0.35, camp: 0.1 },
      teamfight: { invade: 0.05, ambush: -0.1, lane: 0.05, rush: 0.35, wrap: 0.1, camp: 0.05 },
    };
    return (w[style] && w[style][evId]) || 0;
  }

  function phaseBaseWeight(phase, evId) {
    const base = {
      early: { invade: 0.35, lane: 0.1, ambush: 0.3 },
      dragon: { rush: 0.35, wrap: 0.15, camp: 0.3 },
      baron: { rush: 0.3, wrap: 0.2, camp: 0.35 },
    };
    return (base[phase] && base[phase][evId]) || 0;
  }

  /**
   * ctx: {
   *   phase, myStyle, foeStyle, myPower, foePower,
   *   ecoMe, ecoFoe, lastMe, lastFoe, playerSide
   * }
   */
  function predictEvents(ctx) {
    const phaseDef = (S16.PHASES || []).find((p) => p.id === ctx.phase) || S16.PHASES[0];
    const cards = phaseDef.cards.map((c) => ({ ...c }));
    const rows = [];

    for (const ev of cards) {
      const factors = {};
      factors.phase = phaseBaseWeight(ctx.phase, ev.id);
      factors.style = styleEventWeight(ctx.myStyle, ev.id);
      const ecoDiff = (ctx.ecoMe || 0) - (ctx.ecoFoe || 0);
      if (ecoDiff > 0.03) {
        factors.economy = ev.id === "lane" || ev.id === "rush" ? 0.25 : -0.05;
      } else if (ecoDiff < -0.03) {
        factors.economy = ev.id === "ambush" || ev.id === "wrap" ? 0.28 : -0.05;
      } else {
        factors.economy = 0;
      }
      const pDiff = ((ctx.myPower || 80) - (ctx.foePower || 80)) / 20;
      factors.power = pDiff > 0 ? (ev.id === "invade" || ev.id === "rush" ? Math.min(0.35, pDiff) : pDiff * 0.2) : Math.max(-0.25, pDiff * 0.15);

      factors.momentum = 0;
      if (ctx.lastMe && ctx.lastMe === ev.id) factors.momentum += 0.35;
      if (ctx.lastFoe) {
        const phaseCards = phaseDef.cards;
        const foe = phaseCards.find((c) => c.id === ctx.lastFoe);
        // 反制对方上一事件
        if (foe && foe.beats === ev.id) factors.momentum += 0.85;
        if (ev.beats === ctx.lastFoe) factors.momentum += 0.55;
      }

      factors.vs = 0;
      const counter = S16.STYLE_COUNTER || {};
      if (counter[ctx.myStyle] === ctx.foeStyle) {
        factors.vs = ev.id === "invade" || ev.id === "rush" || ev.id === "wrap" ? 0.2 : 0.05;
      } else if (counter[ctx.foeStyle] === ctx.myStyle) {
        factors.vs = ev.id === "camp" || ev.id === "lane" ? 0.12 : -0.08;
      }

      const score = Object.values(factors).reduce((a, b) => a + b, 0);
      rows.push({ ev, factors, score });
    }

    const probs = softmax(rows.map((r) => r.score), 1.15);
    rows.forEach((r, i) => {
      r.prob = probs[i];
    });
    rows.sort((a, b) => b.prob - a.prob);
    return rows;
  }

  function sampleEvent(predRows) {
    const idx = sample(predRows.map((r) => r.prob));
    return predRows[idx];
  }

  function autoSkillCast(skill, phase) {
    if (!skill) return { skill: null, mult: 1, when: "—" };
    const whenMap = {
      early: "对线收割",
      dragon: "隘口齐射",
      baron: "偷龙窗口",
    };
    const mult = skill.mult || 1.05;
    return { skill, mult, when: whenMap[phase] || skill.when || "自动" };
  }

  function rules() {
    return (S16.RULES || {
      revivesPerPlayer: 2,
      livesPerPlayer: 3,
      teamSize: 5,
      seriesWinsNeeded: 3,
    });
  }

  /**
   * Fight until one team is fully wiped (all players use up every life).
   * Each player has `revivesPerPlayer` revives (lives = 1 + revives).
   * Winner = side that still has living members.
   */
  function buildKillFeedUntilWipe(blueTeam, redTeam, powerRatioBlue /* 0..1 */) {
    const R = rules();
    const bRoster = (blueTeam.roster || []).slice(0, R.teamSize);
    const rRoster = (redTeam.roster || []).slice(0, R.teamSize);
    const livesB = bRoster.map(() => R.livesPerPlayer);
    const livesR = rRoster.map(() => R.livesPerPlayer);
    const feed = [];

    const aliveB = () => livesB.some((n) => n > 0);
    const aliveR = () => livesR.some((n) => n > 0);
    const pickAlive = (roster, lives) => {
      const idx = [];
      for (let i = 0; i < roster.length; i++) if (lives[i] > 0) idx.push(i);
      return idx.length ? idx[Math.floor(Math.random() * idx.length)] : -1;
    };

    let guard = 0;
    while (aliveB() && aliveR() && guard < 80) {
      guard++;
      // attacker side biased by power
      const blueScores = Math.random() < powerRatioBlue;
      const killerSide = blueScores ? "blue" : "red";
      const kRoster = killerSide === "blue" ? bRoster : rRoster;
      const kLives = killerSide === "blue" ? livesB : livesR;
      const vRoster = killerSide === "blue" ? rRoster : bRoster;
      const vLives = killerSide === "blue" ? livesR : livesB;

      const ki = pickAlive(kRoster, kLives);
      const vi = pickAlive(vRoster, vLives);
      if (ki < 0 || vi < 0) break;
      const killer = kRoster[ki];
      const victim = vRoster[vi];
      vLives[vi] -= 1;
      const revivesLeft = Math.max(0, vLives[vi]);

      feed.push({
        type: "kill",
        killer: killer.name,
        killerPos: killer.posCn || killer.pos,
        killerTeam: (killerSide === "blue" ? blueTeam : redTeam).short || (killerSide === "blue" ? blueTeam : redTeam).name,
        killerTeamId: killerSide === "blue" ? blueTeam.id : redTeam.id,
        victim: victim.name,
        victimPos: victim.posCn || victim.pos,
        victimTeam: (killerSide === "blue" ? redTeam : blueTeam).short || (killerSide === "blue" ? redTeam : blueTeam).name,
        victimTeamId: killerSide === "blue" ? redTeam.id : blueTeam.id,
        text: `${killer.name}（${killer.posCn || killer.pos}）击杀了 ${victim.name}（${victim.posCn || victim.pos}）`,
        victimRevivesLeft: revivesLeft,
        finalDeath: revivesLeft === 0 && !vLives.some((n) => n > 0),
      });
    }

    // 胜者 = 仍有存活名额的一方；一方被团灭则另一方获胜（与动画一致）
    const blueWiped = !livesB.some((n) => n > 0);
    const redWiped = !livesR.some((n) => n > 0);
    let winner;
    if (blueWiped && !redWiped) winner = "red";
    else if (redWiped && !blueWiped) winner = "blue";
    else if (blueWiped && redWiped) winner = powerRatioBlue >= 0.5 ? "blue" : "red";
    else winner = powerRatioBlue >= 0.5 ? "blue" : "red"; // 超时未分完
    const wiped = winner === "blue" ? "red" : "blue";
    const winnerTeamId = winner === "blue" ? blueTeam.id : redTeam.id;
    const wipedTeamId = winner === "blue" ? redTeam.id : blueTeam.id;
    const killsB = feed.filter((e) => e.killerTeamId === blueTeam.id).length;
    const killsR = feed.filter((e) => e.killerTeamId === redTeam.id).length;
    return {
      feed,
      winner,
      winnerTeamId,
      wipedTeamId,
      killsB,
      killsR,
      wiped,
      blueWiped,
      redWiped,
    };
  }

  /** Keep name for API compatibility — now full wipe fight */
  function buildKillFeed(blueTeam, redTeam, powerRatioBlue = 0.5) {
    return buildKillFeedUntilWipe(blueTeam, redTeam, powerRatioBlue).feed;
  }

  function simulateTeamfight(input) {
    const {
      blue,
      red,
      bluePower,
      redPower,
      ecoB = 1,
      ecoR = 1,
      styleEdgeB = 1,
      styleEdgeR = 1,
      edgeB = 1,
      edgeR = 1,
      skillBlue,
      skillRed,
      objective = "teamfight",
    } = input;

    const castB = autoSkillCast(skillBlue, objective === "baron" ? "baron" : objective === "dragon" ? "dragon" : "early");
    const castR = autoSkillCast(skillRed, objective === "baron" ? "baron" : objective === "dragon" ? "dragon" : "early");

    const finalB = bluePower * ecoB * styleEdgeB * edgeB * castB.mult * rand(0.97, 1.03);
    const finalR = redPower * ecoR * styleEdgeR * edgeR * castR.mult * rand(0.97, 1.03);
    const powerRatioBlue = finalB / (finalB + finalR);

    const wipe = buildKillFeedUntilWipe(blue, red, powerRatioBlue);
    const killFeed = wipe.feed;
    const reportedB = wipe.killsB;
    const reportedR = wipe.killsR;
    const winner = wipe.winner;

    // 对战中途随机发资源 buff：概率由战队战力决定（不与胜负绑定）
    function rollBuff(kind) {
      const powB = Math.max(1, bluePower * styleEdgeB * edgeB);
      const powR = Math.max(1, redPower * styleEdgeR * edgeR);
      let pBlue = powB / (powB + powR);
      pBlue = 0.15 + pBlue * 0.7;
      const buffWinner = Math.random() < pBlue ? "blue" : "red";
      const base = (S16.BUFFS && S16.BUFFS[kind]) || {};
      return {
        id: kind,
        name: kind === "baron" ? (base.name || "大龙增益") : (base.name || "小龙增益"),
        icon: kind === "baron" ? (base.icon || "👑") : (base.icon || "🐉"),
        color: kind === "baron" ? (base.color || "#c868ff") : (base.color || "#4a9eff"),
        dmg: kind === "baron" ? (base.dmg || 1.12) : (base.dmg || 1.08),
        eco: kind === "baron" ? (base.eco || 1.05) : (base.eco || 1.02),
        winner: buffWinner,
        randomBy: "teamPower",
        pBlue: Number(pBlue.toFixed(3)),
      };
    }

    // 中途节点：40% 进度出小龙，70% 进度出大龙（并非只有大龙）
    const timelineBuffs = [
      { at: 0.38, buff: rollBuff("dragon") },
      { at: 0.68, buff: rollBuff("baron") },
    ];
    const buff = timelineBuffs[0].buff; // 兼容字段

    return {
      winner,
      winnerTeamId: wipe.winnerTeamId,
      wipedTeamId: wipe.wipedTeamId,
      killsB: reportedB,
      killsR: reportedR,
      finalB,
      finalR,
      skillB: castB,
      skillR: castR,
      objective,
      killFeed,
      buff,
      timelineBuffs,
      wiped: wipe.wiped,
      wipeEnd: true,
    };
  }

  function drawGroupStage(teams) {
    const pool = teams.slice();
    // shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const matches = [];
    for (let i = 0; i + 1 < pool.length && matches.length < 8; i += 2) {
      matches.push({
        id: "g" + (matches.length + 1),
        stage: "group",
        blue: pool[i].id,
        red: pool[i + 1].id,
        played: false,
        result: null,
      });
    }
    return matches;
  }

  function autoPicks(team) {
    return {
      lineup: pick(["meta", "signature", "offmeta"]),
      style: team.style || pick(["engage", "protect", "split", "teamfight"]),
    };
  }

  function autoLineup(team) {
    return pick(["meta", "signature", "offmeta"]);
  }

  /**
   * One BO1 game: continuous engagement until one team is fully wiped.
   * Still exposes prediction/phase beats for UI, but the game only ends on wipe.
   */
  function simulateMatch(input) {
    const blue = input.blue;
    const red = input.red;
    const blueLineupId = input.blueLineup || autoLineup(blue);
    const redLineupId = input.redLineup || autoLineup(red);
    const blueStyle = input.blueStyle || blue.style;
    const redStyle = input.redStyle || red.style;

    const luB = resolveLineup(blue, blueLineupId);
    const luR = resolveLineup(red, redLineupId);
    const seB = styleEdge(blueStyle, redStyle);
    const seR = styleEdge(redStyle, blueStyle);

    const baseB = (blue.power || 80) * luB.mod;
    const baseR = (red.power || 80) * luR.mod;

    let ecoB = 1;
    let ecoR = 1;
    let lastB = null;
    let lastR = null;
    let hitsTop1 = 0;
    let preds = 0;
    const buffsBlue = [];
    const buffsRed = [];

    // One wipe-based engagement is the whole game (BO1 shown in animation)
    const castB = autoSkillCast(luB.skill, "baron");
    const castR = autoSkillCast(luR.skill, "baron");
    const finalB = baseB * ecoB * seB * castB.mult * rand(0.97, 1.03);
    const finalR = baseR * ecoR * seR * castR.mult * rand(0.97, 1.03);
    const powerRatioBlue = finalB / (finalB + finalR);
    // 只模拟一次团灭战，动画/比分/胜负共用同一结果
    const decisive = simulateTeamfight({
      blue,
      red,
      bluePower: baseB,
      redPower: baseR,
      ecoB,
      ecoR,
      styleEdgeB: seB,
      styleEdgeR: seR,
      edgeB: 1,
      edgeR: 1,
      skillBlue: luB.skill,
      skillRed: luR.skill,
      objective: "baron",
    });

    // 阶段预测（供 UI）：三个节点都跑，但资源 buff 走时间轴中途结算
    const rounds = [];
    for (const phaseDef of S16.PHASES) {
      const ctx = {
        phase: phaseDef.id,
        myStyle: blueStyle,
        foeStyle: redStyle,
        myPower: baseB,
        foePower: baseR,
        ecoMe: ecoB - 1,
        ecoFoe: ecoR - 1,
        lastMe: lastB,
        lastFoe: lastR,
      };
      const predB = predictEvents(ctx);
      const ctxR = {
        phase: phaseDef.id,
        myStyle: redStyle,
        foeStyle: blueStyle,
        myPower: baseR,
        foePower: baseB,
        ecoMe: ecoR - 1,
        ecoFoe: ecoB - 1,
        lastMe: lastR,
        lastFoe: lastB,
      };
      const predR = predictEvents(ctxR);

      const rowB = sampleEvent(predB);
      const rowR = sampleEvent(predR);
      const bEv = rowB.ev;
      const rEv = rowR.ev;

      preds += 1;
      if (predB[0] && predB[0].ev.id === bEv.id) hitsTop1 += 1;

      const edge = counterEdge(bEv.id, rEv.id, phaseDef.id);
      // eco
      if (edge === "a") {
        ecoB += bEv.eco / 200;
        ecoR += (rEv.eco / 200) * 0.15;
      } else if (edge === "b") {
        ecoR += rEv.eco / 200;
        ecoB += (bEv.eco / 200) * 0.15;
      } else {
        ecoB += (bEv.eco / 200) * 0.55;
        ecoR += (rEv.eco / 200) * 0.55;
      }

      lastB = bEv.id;
      lastR = rEv.id;

      const narrative = (S16.NARRATIVE && S16.NARRATIVE[bEv.id] && pick(S16.NARRATIVE[bEv.id]) || "")
        .replace("{team}", blue.short || blue.name)
        .replace("{player}", ((blue.roster || [])[2] || {}).name || "中单")
        .replace("{objective}", phaseDef.name);

      rounds.push({
        phase: phaseDef.id,
        phaseName: phaseDef.name,
        bEv,
        rEv,
        predB: predB.slice(0, 3),
        predR: predR.slice(0, 3),
        edge,
        force: false,
        fight: null,
        ecoB,
        ecoR,
        narrative,
      });
    }

    // attach as the last round's fight so UI plays one BO1 wipe battle
    if (rounds.length) rounds[rounds.length - 1].fight = decisive;
    // 资源 buff 进入整局累计（供赛果展示）
    if (decisive.timelineBuffs) {
      for (const t of decisive.timelineBuffs) {
        if (!t || !t.buff) continue;
        const bag = t.buff.winner === "blue" ? buffsBlue : buffsRed;
        bag.push({ ...t.buff, side: t.buff.winner });
      }
    } else if (decisive.buff) {
      const bag = decisive.buff.winner === "blue" ? buffsBlue : buffsRed;
      bag.push({ ...decisive.buff, side: decisive.buff.winner });
    }

    const killsB = decisive.killsB;
    const killsR = decisive.killsR;
    const objsB = buffsBlue.length;
    const objsR = buffsRed.length;
    // 以团灭方向为准：赢家 = 未被团灭的一方
    const gameWinner = decisive.winner;
    const wipeTeam = decisive.wiped;
    const winnerTeamId = decisive.winnerTeamId || (gameWinner === "blue" ? blue.id : red.id);
    const loserTeamId = decisive.wipedTeamId || (gameWinner === "blue" ? red.id : blue.id);
    const scoreB = winnerTeamId === blue.id ? 1 : 0;
    const scoreR = winnerTeamId === red.id ? 1 : 0;
    const margin = 1;
    let marginKey = "crush";
    if (margin > 0.28) marginKey = "crush";
    else if (margin > 0.12) marginKey = "solid";
    else if (margin <= 0.05) marginKey = "close";

    return {
      rounds,
      timelineBuffs: decisive.timelineBuffs || [],
      killsB,
      killsR,
      objsB,
      objsR,
      scoreB,
      scoreR,
      finalB,
      finalR,
      winner: gameWinner,
      winnerTeamId,
      loserTeamId,
      wipeTeam,
      wipeEnd: true,
      mode: "BO1",
      margin,
      marginKey,
      marginText: (S16.MARGIN_TEXT && S16.MARGIN_TEXT[marginKey]) || marginKey,
      blueLineup: luB,
      redLineup: luR,
      blueStyle,
      redStyle,
      buffsBlue,
      buffsRed,
      predHitRate: preds ? hitsTop1 / preds : 0,
    };
  }

  /**
   * BO5 series: first to 3 game wins. Animation typically shows only one game.
   */
  function simulateSeries(input) {
    const R = rules();
    const need = R.seriesWinsNeeded;
    const games = [];
    let winsB = 0;
    let winsR = 0;
    while (winsB < need && winsR < need && games.length < 5) {
      const g = simulateMatch({
        ...input,
        blueLineup: input.blueLineup || autoLineup(input.blue),
        redLineup: input.redLineup || autoLineup(input.red),
      });
      games.push(g);
      if (g.winner === "blue") winsB += 1;
      else winsR += 1;
    }
    const winner = winsB >= need ? "blue" : "red";
    return {
      mode: "BO5",
      winsB,
      winsR,
      winner,
      games,
      // UI animates one BO1 only (first game of the series)
      animatedGameIndex: 0,
      animatedGame: games[0] || null,
    };
  }

  return {
    rand,
    pick,
    clamp,
    softmax,
    sample,
    resolveLineup,
    styleEdge,
    counterEdge,
    predictEvents,
    simulateMatch,
    simulateSeries,
    simulateTeamfight,
    buildKillFeedUntilWipe,
    autoSkillCast,
    buildKillFeed,
    autoPicks,
    autoLineup,
    drawGroupStage,
  };
})();
