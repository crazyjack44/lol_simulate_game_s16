/* Teamfight canvas animation — fixed positions, player avatars, attack/hit VFX, 3 revives, objective buffs */
window.S16 = window.S16 || {};

S16._animImageCache = S16._animImageCache || new Map();

S16.TeamfightAnim = class TeamfightAnim {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.units = [];
    this.projectiles = [];
    this.particles = [];
    this.flashes = [];
    this.hitMarks = [];
    this.killFeed = [];
    this.feedIdx = 0;
    this.t0 = 0;
    this.raf = null;
    this.onLog = null;
    this.onDone = null;
    this.running = false;
    this.duration = 4200;
    this.reviveDelay = 480;
    this.killInterval = 420;
  }

  _loadImage(src) {
    if (!src) return null;
    if (S16._animImageCache.has(src)) return S16._animImageCache.get(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    S16._animImageCache.set(src, img);
    return img;
  }

  start(cfg) {
    this.cfg = cfg;
    this.running = true;
    this._doneFired = false;
    this.t0 = performance.now();
    this.projectiles = [];
    this.particles = [];
    this.flashes = [];
    this.hitMarks = [];
    this.killFeed = cfg.killFeed || [];
    this.feedIdx = 0;
    this.units = this._buildUnits(cfg);
    this._wipeAt = 0;
    this._wipePending = false;
    this._endingAt = 0;
    this._timelineBuffs = (cfg.timelineBuffs || []).slice();
    this._buffFired = new Set();
    this.cfg._showPhase = "战况推演";
    const feedCount = this.killFeed.length;
    const feedEnd = 400 + feedCount * this.killInterval + this.reviveDelay + 900;
    this.duration = Math.max(3600, feedEnd);
    const objName =
      cfg.objective === "baron" ? "大龙团" : cfg.objective === "dragon" ? "小龙团" : "团战";
    this._log(`⚔ ${cfg.blueName} vs ${cfg.redName} · ${objName}`);
    if (cfg.skillBlue)
      this._log(
        `✨ ${cfg.blueName} · ${cfg.skillBlue.skill ? cfg.skillBlue.skill.name : "技能"}（${cfg.skillBlue.when || ""}）`
      );
    if (cfg.skillRed)
      this._log(
        `✨ ${cfg.redName} · ${cfg.skillRed.skill ? cfg.skillRed.skill.name : "技能"}（${cfg.skillRed.when || ""}）`
      );
    // show existing buffs on units
    for (const side of ["blue", "red"]) {
      const buffs = cfg[side === "blue" ? "buffsBlue" : "buffsRed"] || [];
      for (const b of buffs) {
        this._log(`◈ ${(side === "blue" ? cfg.blueName : cfg.redName)} 获得 ${b.icon} ${b.name}`);
      }
    }
    this._loop();
  }

  useSkill(kind) {
    this.flashes.push({ t: performance.now(), kind, life: 500 });
    this._log(`🎬 程序释放技能：${kind}`);
  }

  _log(msg) {
    if (this.onLog) this.onLog(msg);
  }

  _buildUnits(cfg) {
    const positions = ["top", "jng", "mid", "bot", "sup"];
    const posCn = { top: "上单", jng: "打野", mid: "中单", bot: "下路", sup: "辅助" };
    const blue = (cfg.blueRoster || []).slice(0, 5);
    const red = (cfg.redRoster || []).slice(0, 5);
    const units = [];
    // fixed two columns, generous vertical spacing so names never collide
    const layoutY = (i) => 72 + i * 64;
    for (let i = 0; i < 5; i++) {
      const b = blue[i] || { name: "B" + i, pos: positions[i] };
      const r = red[i] || { name: "R" + i, pos: positions[i] };
      units.push({
        id: "b" + i,
        side: "blue",
        pos: b.pos || positions[i],
        posCn: b.posCn || posCn[b.pos || positions[i]],
        name: b.name,
        photo: b.photo,
        img: this._loadImage(b.photo),
        x: 210,
        y: layoutY(i),
        hp: 100,
        maxHp: 100,
        alive: true,
        deadAt: 0,
        reviveAt: 0,
        revivesLeft: 2,
        hitFlash: 0,
        atkFlash: 0,
      });
      units.push({
        id: "r" + i,
        side: "red",
        pos: r.pos || positions[i],
        posCn: r.posCn || posCn[r.pos || positions[i]],
        name: r.name,
        photo: r.photo,
        img: this._loadImage(r.photo),
        x: 430,
        y: layoutY(i),
        hp: 100,
        maxHp: 100,
        alive: true,
        deadAt: 0,
        reviveAt: 0,
        revivesLeft: 2,
        hitFlash: 0,
        atkFlash: 0,
      });
    }
    return units;
  }

  _vfxBusy() {
    return (
      this.projectiles.length > 0 ||
      this.particles.length > 0 ||
      this.hitMarks.length > 0 ||
      this.flashes.length > 0
    );
  }

  _finishIfReady(now, t) {
    const feedDone = this.feedIdx >= this.killFeed.length;
    const shouldEnd =
      (t >= this.duration && feedDone) || (this._wipeAt && feedDone && now - this._wipeAt > 600);
    if (!shouldEnd) return false;
    // 特效还在播就继续帧，不提前停
    if (this._vfxBusy() && !this._endingAt) {
      this._endingAt = now;
    }
    if (this._vfxBusy()) {
      // 最多再等 1s 特效，避免永卡
      if (this._endingAt && now - this._endingAt > 1000) {
        this.projectiles = [];
        this.particles = [];
        this.hitMarks = [];
        this.flashes = [];
      } else {
        return false;
      }
    }
    this.running = false;
    if (!this._doneFired) {
      this._doneFired = true;
      try {
        if (this.onDone) this.onDone();
      } catch (e) {
        console.error("onDone failed", e);
      }
    }
    return true;
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    const t = now - this.t0;
    try {
      // 中途资源 buff：按进度触发（小龙约 40%，大龙约 70%）
      if (this._timelineBuffs && this._timelineBuffs.length && this.duration > 0) {
        const progress = Math.min(1, t / this.duration);
        this._timelineBuffs.forEach((node, i) => {
          if (this._buffFired.has(i)) return;
          if (progress >= node.at && node.buff) {
            this._buffFired.add(i);
            this._log(
              `◈ 中途结算 · ${node.buff.name} → ${node.buff.winner === "blue" ? this.cfg.blueName : this.cfg.redName}`
            );
            if (this.onBuff) {
              try {
                this.onBuff(node.buff, progress);
              } catch (e) {}
            }
          }
        });
        this.cfg._showPhase = "战况推演";
      }
      this._update(t, now);
      this._draw(now);
    } catch (err) {
      console.error("TeamfightAnim frame error", err);
      this.running = false;
      if (!this._doneFired) {
        this._doneFired = true;
        try {
          if (this.onDone) this.onDone();
        } catch (e) {}
      }
      return;
    }
    if (this._finishIfReady(now, t)) return;
    this.raf = requestAnimationFrame(() => this._loop());
  }

  _buffMult(side) {
    const list =
      (side === "blue" ? this.cfg.buffsBlue : this.cfg.buffsRed) || [];
    return list.reduce((m, b) => m * (b.dmg || 1), 1);
  }

  _update(t, now) {
    // units hold position — no movement

    // periodic attack projectiles — 收束阶段不再生成
    if (!this._endingAt && Math.random() < 0.18) {
      const aliveB = this.units.filter((u) => u.side === "blue" && u.alive);
      const aliveR = this.units.filter((u) => u.side === "red" && u.alive);
      if (aliveB.length && aliveR.length) {
        const from = Math.random() < 0.5 ? aliveB : aliveR;
        const to = from === aliveB ? aliveR : aliveB;
        const a = from[Math.floor(Math.random() * from.length)];
        const b = to[Math.floor(Math.random() * to.length)];
        a.atkFlash = now + 220;
        this.projectiles.push({
          x: a.x,
          y: a.y,
          sx: a.x,
          sy: a.y,
          tx: b.x,
          ty: b.y,
          color: a.side === "blue" ? "#0ac8b9" : "#e84057",
          born: now,
          life: 380,
          target: b,
          attacker: a,
        });
      }
    }

    // projectiles → hit effects
    this.projectiles = this.projectiles.filter((p) => {
      const k = 0.22;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
      if (dist < 10 && p.target && p.target.alive) {
        const mult = this._buffMult(p.attacker ? p.attacker.side : "blue");
        const dmg = (7 + Math.random() * 9) * mult;
        p.target.hp -= dmg;
        p.target.hitFlash = now + 280;
        this.hitMarks.push({
          x: p.target.x,
          y: p.target.y,
          born: now,
          life: 260,
          color: p.color,
        });
        for (let i = 0; i < 7; i++) {
          this.particles.push({
            x: p.tx,
            y: p.ty,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            life: 280,
            born: now,
            color: p.color,
          });
        }
        // 平A 只做受击 VFX，不扣复活次数（胜负以击杀播报/引擎为准）
        if (p.target.hp <= 0) {
          p.target.hp = 8; // 保留一口气，避免与引擎团灭不一致
          p.target.hitFlash = now + 320;
        }
        return false;
      }
      return now - p.born < p.life;
    });

    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      return now - p.born < p.life;
    });

    this.hitMarks = this.hitMarks.filter((h) => now - h.born < h.life);
    this.flashes = this.flashes.filter((f) => now - f.t < f.life);

    // scripted kill feed timing — paced with the fight so log and canvas stay in sync
    while (this.feedIdx < this.killFeed.length && t > 400 + this.feedIdx * this.killInterval) {
      const ev = this.killFeed[this.feedIdx];
      const victim =
        this.units.find((u) => u.name === ev.victim && u.alive) ||
        this.units.find((u) => u.name === ev.victim);
      if (victim && victim.alive) {
        this._handleDeath(victim, now, "击杀播报");
      } else if (victim && !victim.alive && victim.revivesLeft > 0 && victim.reviveAt) {
        // already dying — force next life if still have revives
        this._handleDeath(victim, now, "击杀播报");
      }
      this._log(`💀 ${ev.text}`);
      this.feedIdx++;
    }

    // revive timers
    for (const u of this.units) {
      if (!u.alive && u.reviveAt && now >= u.reviveAt) {
        u.alive = true;
        u.hp = u.maxHp;
        u.reviveAt = 0;
        u.hitFlash = 0;
        this.flashes.push({ t: now, kind: "revive", life: 500, x: u.x, y: u.y, color: u.side === "blue" ? "#0ac8b9" : "#e84057" });
        this._log(
          `💛 ${u.name}（${u.posCn}）复活（剩余复活 ${u.revivesLeft} 次）`
        );
        for (let i = 0; i < 12; i++) {
          this.particles.push({
            x: u.x,
            y: u.y,
            vx: (Math.random() - 0.5) * 3,
            vy: -Math.random() * 3,
            life: 550,
            born: now,
            color: u.side === "blue" ? "#7dfff2" : "#ff9aa8",
          });
        }
      }
    }

    // team wipe → 等击杀时间轴播完再收束，避免半场卡住
    const sideWiped = (side) => {
      const list = this.units.filter((u) => u.side === side);
      return (
        list.length > 0 &&
        list.every((u) => !u.alive && !u.reviveAt && u.revivesLeft <= 0)
      );
    };
    const feedDone = this.feedIdx >= this.killFeed.length;
    if (!this._wipeAt && feedDone && (sideWiped("blue") || sideWiped("red") || this.cfg.wipeSide)) {
      this._wipeAt = now;
      const wipeSide =
        this.cfg.wipeSide ||
        (sideWiped("blue") ? "blue" : sideWiped("red") ? "red" : null);
      const loser = wipeSide === "blue" ? this.cfg.blueName : this.cfg.redName;
      const winner = wipeSide === "blue" ? this.cfg.redName : this.cfg.blueName;
      this._log(`🏁 ${loser} 全员阵亡 · ${winner} 获胜（本局 BO1 结束）`);
      const need = (now - this.t0) + this.reviveDelay + 800;
      if (need > this.duration) this.duration = need;
      return;
    }

    // 团灭但击杀播报未播完：只标记，不结束
    if (!this._wipePending && (sideWiped("blue") || sideWiped("red")) && !feedDone) {
      this._wipePending = true;
    }

    if (this._wipeAt && feedDone) {
      this._endingAt = this._endingAt || now;
    }
  }

  _handleDeath(unit, now, source) {
    unit.hp = 0;
    unit.alive = false;
    unit.deadAt = now;
    if (unit.revivesLeft > 0) {
      unit.revivesLeft -= 1;
      unit.reviveAt = now + this.reviveDelay;
    } else {
      unit.reviveAt = 0;
    }
    this.flashes.push({
      t: now,
      kind: "kill",
      life: 420,
      x: unit.x,
      y: unit.y,
    });
    this.hitMarks.push({
      x: unit.x,
      y: unit.y,
      born: now,
      life: 500,
      color: "#f0e6d2",
      big: true,
    });
    for (let i = 0; i < 16; i++) {
      this.particles.push({
        x: unit.x,
        y: unit.y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.6) * 6,
        life: 480,
        born: now,
        color: "#f0e6d2",
      });
    }
    if (unit.revivesLeft >= 0 && unit.reviveAt) {
      this._log(
        `☠ ${unit.name}（${unit.posCn}）被击倒 · 还可复活 ${unit.revivesLeft + 1} 次（${source}）`
      );
    } else {
      this._log(`💀 ${unit.name}（${unit.posCn}）阵亡（无复活 · ${source}）`);
    }
  }

  _draw(now) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 360;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#121a28");
    g.addColorStop(1, "#0b1018");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // center divider only — no objective marker
    ctx.strokeStyle = "rgba(200,170,110,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 16);
    ctx.lineTo(w / 2, h - 16);
    ctx.stroke();

    // particles
    for (const p of this.particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - (now - p.born) / p.life);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // attack projectiles
    for (const p of this.projectiles) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.tx - p.x) * 0.2, p.y - (p.ty - p.y) * 0.2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    // hit marks
    for (const h of this.hitMarks) {
      const a = Math.max(0, 1 - (now - h.born) / h.life);
      const r = h.big ? 18 + (1 - a) * 16 : 10 + (1 - a) * 8;
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = h.color;
      ctx.globalAlpha = a * 0.85;
      ctx.lineWidth = h.big ? 3 : 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // units — fixed columns, name on outer side to avoid overlap
    const fitText = (text, maxW) => {
      let s = text || "";
      if (ctx.measureText(s).width <= maxW) return s;
      while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
      return s + "…";
    };

    for (const u of this.units) {
      const color = u.side === "blue" ? "#0ac8b9" : "#e84057";
      const buffs = (u.side === "blue" ? this.cfg.buffsBlue : this.cfg.buffsRed) || [];
      const isBlue = u.side === "blue";

      // hit flash ring
      if (u.hitFlash > now) {
        ctx.beginPath();
        ctx.arc(u.x, u.y, 22, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,80,80,0.28)";
        ctx.fill();
      }

      // attack flash
      if (u.atkFlash > now) {
        ctx.beginPath();
        ctx.arc(u.x, u.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // body — circular player avatar
      const r = u.alive ? 18 : 11;
      const strokeCol = u.alive
        ? buffs.length
          ? buffs[buffs.length - 1].color || color
          : color
        : "#555";

      ctx.beginPath();
      ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
      ctx.save();
      ctx.clip();
      if (u.img && u.img.complete && u.img.naturalWidth > 0) {
        // cover-fit the portrait into the circle
        const iw = u.img.naturalWidth;
        const ih = u.img.naturalHeight;
        const side = r * 2;
        const scale = Math.max(side / iw, side / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(u.img, u.x - dw / 2, u.y - dh / 2, dw, dh);
        if (!u.alive) {
          ctx.fillStyle = "rgba(20,20,20,0.55)";
          ctx.fillRect(u.x - r, u.y - r, side, side);
        }
      } else {
        ctx.fillStyle = u.alive ? (buffs.length ? buffs[buffs.length - 1].color || color : color) + "44" : "rgba(70,70,70,0.4)";
        ctx.fillRect(u.x - r, u.y - r, r * 2, r * 2);
        ctx.fillStyle = u.alive ? "#f0e6d2" : "#888";
        ctx.font = "bold 11px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((u.name || "?").slice(0, 2), u.x, u.y);
      }
      ctx.restore();

      // ring
      ctx.beginPath();
      ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = strokeCol;
      ctx.stroke();

      // hp bar (compact, above circle)
      if (u.alive) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(u.x - 16, u.y - 24, 32, 3);
        ctx.fillStyle = color;
        ctx.fillRect(u.x - 16, u.y - 24, 32 * Math.max(0, u.hp / u.maxHp), 3);
      } else {
        ctx.fillStyle = "rgba(232,64,87,0.9)";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(u.reviveAt ? "⏳" : "✕", u.x, u.y);
      }

      // label block on OUTER side: [revive dots] name [buff dots]
      // blue → left of unit, red → right of unit
      const nameFont = "12px Segoe UI, PingFang SC, Microsoft YaHei, sans-serif";
      ctx.font = nameFont;
      const maxNameW = 120;
      const label = fitText(u.name, maxNameW);
      const nameW = ctx.measureText(label).width;

      // revive dots (2 revives) + name + buff dots in one row
      const dotCount = 2;
      const dotW = 12;
      const buffDotW = buffs.length ? 8 + buffs.length * 10 : 0;
      const rowW = dotW + 6 + nameW + 6 + buffDotW;

      let rowX;
      if (isBlue) {
        rowX = u.x - 28 - rowW; // right-aligned toward center, left of unit
      } else {
        rowX = u.x + 28;
      }
      const rowY = u.y;

      // revive dots
      for (let i = 0; i < dotCount; i++) {
        const lx = rowX + i * 5.5 + 2;
        ctx.beginPath();
        ctx.arc(lx, rowY, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = i < u.revivesLeft ? (u.alive ? "#f0e6d2" : "#c8aa6e") : "rgba(240,230,210,0.2)";
        ctx.fill();
      }

      // name
      ctx.fillStyle = u.alive ? "#f0e6d2" : "rgba(240,230,210,0.42)";
      ctx.font = nameFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, rowX + dotW, rowY);

      // buff dots after name
      if (buffs.length && u.alive) {
        let bx = rowX + dotW + nameW + 8;
        for (const b of buffs) {
          ctx.beginPath();
          ctx.arc(bx, rowY, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = b.color || "#c8aa6e";
          ctx.fill();
          bx += 10;
        }
      }
    }

    // skill flash overlay
    for (const f of this.flashes) {
      const alpha = Math.max(0, 1 - (now - f.t) / f.life);
      if (f.kind === "revive" && f.x != null) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, 26 + (1 - alpha) * 18, 0, Math.PI * 2);
        ctx.strokeStyle = f.color || "#f0e6d2";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.kind === "kill" && f.x != null) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, 20 + (1 - alpha) * 14, 0, Math.PI * 2);
        ctx.strokeStyle = "#e84057";
        ctx.globalAlpha = alpha * 0.9;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = `rgba(240,230,210,${alpha * 0.1})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // top scoreboard (compact, no overlapping unit labels)
    const bAlive = this.units.filter((u) => u.side === "blue" && u.alive).length;
    const rAlive = this.units.filter((u) => u.side === "red" && u.alive).length;
    ctx.fillStyle = "rgba(11,14,20,0.45)";
    ctx.fillRect(12, 8, w - 24, 28);
    ctx.font = "bold 12px Segoe UI, PingFang SC, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#0ac8b9";
    ctx.textAlign = "left";
    ctx.fillText(`${this.cfg.blueName} 存活 ${bAlive}`, 22, 22);
    ctx.fillStyle = "#e84057";
    ctx.textAlign = "right";
    ctx.fillText(`${rAlive} 存活 ${this.cfg.redName}`, w - 22, 22);
    ctx.fillStyle = "rgba(240,230,210,0.55)";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    const objLabel =
      this.cfg.objective === "baron" ? "大龙团" : this.cfg.objective === "dragon" ? "小龙团" : "团战";
    ctx.fillText(this.cfg._showPhase || "战况推演", w / 2, 22);
  }
};
