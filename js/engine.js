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

  function buildKillFeed(blueTeam, redTeam, killsB, killsR) {
    const feed = [];
    const bRoster = (blueTeam.roster || []).slice();
    const rRoster = (redTeam.roster || []).slice();
    const deathsB = new Set();
    const deathsR = new Set();

    const total = killsB + killsR;
    for (let i = 0; i < total; i++) {
      const killerIsBlue = killsB > 0 && (killsR === 0 || Math.random() < killsB / (killsB + killsR));
      if (killerIsBlue) {
        const killer = pick(bRoster.filter((p) => !deathsR.has(p.name + ":b") ));
        // victim from red, prefer not already dead more than once conceptually
        const aliveR = rRoster.filter((p) => !deathsR.has(p.name));
        const victim = aliveR.length ? pick(aliveR) : pick(rRoster);
        deathsR.add(victim.name);
        feed.push({
          type: "kill",
          killer: killer.name,
          killerPos: killer.posCn || killer.pos,
          killerTeam: blueTeam.short || blueTeam.name,
          killerTeamId: blueTeam.id,
          victim: victim.name,
          victimPos: victim.posCn || victim.pos,
          victimTeam: redTeam.short || redTeam.name,
          victimTeamId: redTeam.id,
          text: `${killer.name}（${killer.posCn || killer.pos}）击杀了 ${victim.name}（${victim.posCn || victim.pos}）`,
        });
      } else {
        const killer = pick(rRoster);
        const aliveB = bRoster.filter((p) => !deathsB.has(p.name));
        const victim = aliveB.length ? pick(aliveB) : pick(bRoster);
        deathsB.add(victim.name);
        feed.push({
          type: "kill",
          killer: killer.name,
          killerPos: killer.posCn || killer.pos,
          killerTeam: redTeam.short || redTeam.name,
          killerTeamId: redTeam.id,
          victim: victim.name,
          victimPos: victim.posCn || victim.pos,
          victimTeam: blueTeam.short || blueTeam.name,
          victimTeamId: blueTeam.id,
          text: `${killer.name}（${killer.posCn || killer.pos}）击杀了 ${victim.name}（${victim.posCn || victim.pos}）`,
        });
      }
    }
    return feed;
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
    const ratio = finalB / (finalB + finalR);
    const totalKills = 3 + Math.floor(rand(0, 7));
    let killsB = Math.round(totalKills * ratio);
    let killsR = totalKills - killsB;
    // clamp
    killsB = clamp(0, totalKills, killsB);
    killsR = totalKills - killsB;

    const winner = finalB >= finalR ? "blue" : "red";
    const killFeed = buildKillFeed(blue, red, killsB, killsR);
    return {
      winner,
      killsB,
      killsR,
      finalB,
      finalR,
      skillB: castB,
      skillR: castR,
      objective,
      killFeed,
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
   * Full match simulation (no player event cards).
   * input: { blue, red, blueLineup, redLineup, blueStyle, redStyle }
   * returns rounds[] + stats
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
    let killsB = 0;
    let killsR = 0;
    let objsB = 0;
    let objsR = 0;
    let hitsTop1 = 0;
    let preds = 0;

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

      const ecoDiff = Math.abs(ecoB - ecoR);
      let fight = null;
      const isEarly = phaseDef.id === "early";
      const sameId = bEv.id === rEv.id;
      let force = false;
      if (ecoDiff > 0.12 && Math.random() < 0.55) force = true;

      const shouldFight =
        force ||
        (sameId && !isEarly) ||
        (edge === "none" && !isEarly && Math.random() < 0.45) ||
        (phaseDef.id === "baron" && Math.random() < 0.92) ||
        (phaseDef.id === "dragon" && Math.random() < 0.55) ||
        (isEarly && sameId && Math.random() < 0.35);

      if (shouldFight) {
        let edgeB = 1;
        let edgeR = 1;
        if (!force) {
          if (edge === "a") edgeB = 1.12;
          if (edge === "b") edgeR = 1.12;
        }
        fight = simulateTeamfight({
          blue,
          red,
          bluePower: baseB,
          redPower: baseR,
          ecoB,
          ecoR,
          styleEdgeB: seB,
          styleEdgeR: seR,
          edgeB,
          edgeR,
          skillBlue: luB.skill,
          skillRed: luR.skill,
          objective: phaseDef.id === "early" ? "teamfight" : phaseDef.id,
        });
        killsB += fight.killsB;
        killsR += fight.killsR;
        if (fight.winner === "blue") objsB += phaseDef.id === "early" ? 0 : 1;
        else objsR += phaseDef.id === "early" ? 0 : 1;
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
        force,
        fight,
        ecoB,
        ecoR,
        narrative,
      });
    }

    // final score
    const finalB = baseB * ecoB * seB * rand(0.97, 1.03) * (1 + killsB * 0.012);
    const finalR = baseR * ecoR * seR * rand(0.97, 1.03) * (1 + killsR * 0.012);
    const scoreB = finalB + killsB * 1.8 + objsB * 2.5;
    const scoreR = finalR + killsR * 1.8 + objsR * 2.5;
    const winner = scoreB >= scoreR ? "blue" : "red";
    const margin = Math.abs(scoreB - scoreR) / Math.max(scoreB, scoreR, 1);
    let marginKey = "close";
    if (margin > 0.28) marginKey = "crush";
    else if (margin > 0.12) marginKey = "solid";
    else if (margin < 0.05) marginKey = "comeback";

    return {
      rounds,
      killsB,
      killsR,
      objsB,
      objsR,
      scoreB,
      scoreR,
      finalB,
      finalR,
      winner,
      margin,
      marginKey,
      marginText: (S16.MARGIN_TEXT && S16.MARGIN_TEXT[marginKey]) || marginKey,
      blueLineup: luB,
      redLineup: luR,
      blueStyle,
      redStyle,
      predHitRate: preds ? hitsTop1 / preds : 0,
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
    simulateTeamfight,
    autoSkillCast,
    buildKillFeed,
    autoPicks,
    autoLineup,
    drawGroupStage,
  };
})();
