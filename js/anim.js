/* Teamfight canvas animation */
window.S16 = window.S16 || {};

S16.TeamfightAnim = class TeamfightAnim {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.units = [];
    this.projectiles = [];
    this.particles = [];
    this.flashes = [];
    this.killFeed = [];
    this.feedIdx = 0;
    this.t0 = 0;
    this.raf = null;
    this.onLog = null;
    this.onDone = null;
    this.running = false;
    this.duration = 6500;
  }

  start(cfg) {
    this.cfg = cfg;
    this.running = true;
    this.t0 = performance.now();
    this.projectiles = [];
    this.particles = [];
    this.flashes = [];
    this.killFeed = cfg.killFeed || [];
    this.feedIdx = 0;
    this.units = this._buildUnits(cfg);
    this._log(`⚔ ${cfg.blueName} vs ${cfg.redName} · ${cfg.objective === "baron" ? "大龙团" : cfg.objective === "dragon" ? "小龙团" : "团战"}`);
    if (cfg.skillBlue) this._log(`✨ ${cfg.blueName} · ${cfg.skillBlue.skill ? cfg.skillBlue.skill.name : "技能"}（${cfg.skillBlue.when || ""}）`);
    if (cfg.skillRed) this._log(`✨ ${cfg.redName} · ${cfg.skillRed.skill ? cfg.skillRed.skill.name : "技能"}（${cfg.skillRed.when || ""}）`);
    this._loop();
  }

  useSkill(kind) {
    // retained capability — auto flow may call
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
        x: 80 + i * 40,
        y: 70 + i * 28,
        tx: 420 + i * 36,
        ty: 80 + i * 30,
        hp: 100,
        alive: true,
        deadAt: 0,
      });
      units.push({
        id: "r" + i,
        side: "red",
        pos: r.pos || positions[i],
        posCn: r.posCn || posCn[r.pos || positions[i]],
        name: r.name,
        photo: r.photo,
        x: 520 + i * 36,
        y: 70 + i * 28,
        tx: 160 + i * 40,
        ty: 80 + i * 30,
        hp: 100,
        alive: true,
        deadAt: 0,
      });
    }
    return units;
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    const t = now - this.t0;
    this._update(t, now);
    this._draw(now);
    if (t >= this.duration) {
      this.running = false;
      if (this.onDone) this.onDone();
      return;
    }
    this.raf = requestAnimationFrame(() => this._loop());
  }

  _update(t, now) {
    // movement toward targets
    for (const u of this.units) {
      if (!u.alive) continue;
      u.x += (u.tx - u.x) * 0.01;
      u.y += (u.ty - u.y) * 0.01;
    }

    // spawn projectiles periodically
    if (Math.random() < 0.12) {
      const aliveB = this.units.filter((u) => u.side === "blue" && u.alive);
      const aliveR = this.units.filter((u) => u.side === "red" && u.alive);
      if (aliveB.length && aliveR.length) {
        const from = Math.random() < 0.5 ? aliveB : aliveR;
        const to = from === aliveB ? aliveR : aliveB;
        const a = from[Math.floor(Math.random() * from.length)];
        const b = to[Math.floor(Math.random() * to.length)];
        this.projectiles.push({
          x: a.x,
          y: a.y,
          tx: b.x,
          ty: b.y,
          color: a.side === "blue" ? "#0ac8b9" : "#e84057",
          born: now,
          life: 420,
          target: b,
        });
      }
    }

    // projectile updates
    this.projectiles = this.projectiles.filter((p) => {
      const k = 0.18;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      const dist = Math.hypot(p.tx - p.x, p.ty - p.y);
      if (dist < 8 && p.target && p.target.alive) {
        p.target.hp -= 8 + Math.random() * 10;
        for (let i = 0; i < 6; i++) {
          this.particles.push({
            x: p.tx,
            y: p.ty,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 300,
            born: now,
            color: p.color,
          });
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

    // kill feed timing
    while (this.feedIdx < this.killFeed.length && t > 800 + this.feedIdx * 900) {
      const ev = this.killFeed[this.feedIdx];
      const victim = this.units.find((u) => u.name === ev.victim && u.alive);
      if (victim) {
        victim.alive = false;
        victim.hp = 0;
        victim.deadAt = now;
        this.flashes.push({ t: now, kind: "kill", life: 400, x: victim.x, y: victim.y });
        for (let i = 0; i < 14; i++) {
          this.particles.push({
            x: victim.x,
            y: victim.y,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.6) * 6,
            life: 500,
            born: now,
            color: "#f0e6d2",
          });
        }
      }
      this._log(`💀 ${ev.text}`);
      this.feedIdx++;
    }

    // passive damage deaths near end if feed shorter
    if (t > this.duration - 600) {
      for (const u of this.units) {
        if (u.alive && u.hp < 12) {
          u.alive = false;
          u.deadAt = now;
        }
      }
    }

    this.flashes = this.flashes.filter((f) => now - f.t < f.life);
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
    // background
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#0d1522");
    g.addColorStop(0.5, "#152033");
    g.addColorStop(1, "#1a1020");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // river hint
    ctx.strokeStyle = "rgba(12,200,185,0.12)";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h);
    ctx.lineTo(w * 0.55, 0);
    ctx.stroke();

    // objective marker
    const ox = w / 2;
    const oy = h / 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 34, 0, Math.PI * 2);
    ctx.fillStyle = this.cfg.objective === "baron" ? "rgba(200,80,200,0.2)" : this.cfg.objective === "dragon" ? "rgba(80,160,255,0.2)" : "rgba(200,170,110,0.15)";
    ctx.fill();
    ctx.strokeStyle = "rgba(200,170,110,0.45)";
    ctx.stroke();
    ctx.fillStyle = "#f0e6d2";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.cfg.objective === "baron" ? "大龙" : this.cfg.objective === "dragon" ? "小龙" : "团战", ox, oy + 4);

    // particles
    for (const p of this.particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - (now - p.born) / p.life);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // projectiles
    for (const p of this.projectiles) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.tx - p.x) * 0.15, p.y - (p.ty - p.y) * 0.15);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // units
    for (const u of this.units) {
      const color = u.side === "blue" ? "#0ac8b9" : "#e84057";
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.alive ? 16 : 10, 0, Math.PI * 2);
      ctx.fillStyle = u.alive ? color + "33" : "rgba(80,80,80,0.35)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = u.alive ? color : "#666";
      ctx.stroke();

      // photo chip
      if (u.photo) {
        // keep simple circle with initials if image not decoded
        ctx.fillStyle = u.alive ? color : "#555";
        ctx.font = "bold 10px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((u.name || "?").slice(0, 2), u.x, u.y);
      }

      // name
      ctx.fillStyle = u.alive ? "#f0e6d2" : "rgba(240,230,210,0.35)";
      ctx.font = "11px Segoe UI, PingFang SC, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(u.name, u.x, u.y + 18);

      // hp bar
      if (u.alive) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(u.x - 16, u.y - 24, 32, 4);
        ctx.fillStyle = color;
        ctx.fillRect(u.x - 16, u.y - 24, 32 * Math.max(0, u.hp / 100), 4);
      } else {
        ctx.fillStyle = "rgba(232,64,87,0.85)";
        ctx.font = "12px sans-serif";
        ctx.fillText("✕", u.x, u.y - 4);
      }
    }

    // skill flash
    for (const f of this.flashes) {
      const alpha = Math.max(0, 1 - (now - f.t) / f.life);
      ctx.fillStyle = `rgba(240,230,210,${alpha * 0.12})`;
      ctx.fillRect(0, 0, w, h);
    }

    // scoreboard
    const bAlive = this.units.filter((u) => u.side === "blue" && u.alive).length;
    const rAlive = this.units.filter((u) => u.side === "red" && u.alive).length;
    ctx.fillStyle = "rgba(11,14,20,0.55)";
    ctx.fillRect(12, 12, 170, 36);
    ctx.fillStyle = "#0ac8b9";
    ctx.font = "bold 13px Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${this.cfg.blueName} ${bAlive}`, 22, 30);
    ctx.fillStyle = "#e84057";
    ctx.textAlign = "right";
    ctx.fillText(`${rAlive} ${this.cfg.redName}`, 172, 30);
  }
};
