/* Radar chart drawing API */
window.S16 = window.S16 || {};

S16.Radar = {
  drawRadar(canvas, series, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const width = opts.width || canvas.clientWidth || 280;
    const height = opts.height || canvas.clientHeight || 280;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = opts.pad != null ? opts.pad : 36;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - pad;
    const labelColor = opts.labelColor || "rgba(240,230,210,0.72)";
    const ringColor = opts.ringColor || "rgba(200,170,110,0.22)";
    const axisColor = opts.axisColor || "rgba(200,170,110,0.35)";

    // labels from first series keys or opts.labels
    const labels =
      opts.labels || (series[0] && series[0].values ? Object.keys(series[0].values) : []);
    const n = labels.length;
    if (!n) return;

    const angleAt = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

    // rings
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) {
      const rr = (radius * r) / 4;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = angleAt(i);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // axes
    ctx.strokeStyle = axisColor;
    for (let i = 0; i < n; i++) {
      const a = angleAt(i);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
    }

    // series polygons
    for (const s of series) {
      const values = labels.map((lab) => Number(s.values[lab] ?? 50));
      const color = s.color || "#c8aa6e";
      const fill = s.fill || color + "33";

      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = angleAt(i);
        const v = Math.max(0, Math.min(100, values[i])) / 100;
        const x = cx + Math.cos(a) * radius * v;
        const y = cy + Math.sin(a) * radius * v;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // vertices
      for (let i = 0; i < n; i++) {
        const a = angleAt(i);
        const v = Math.max(0, Math.min(100, values[i])) / 100;
        const x = cx + Math.cos(a) * radius * v;
        const y = cy + Math.sin(a) * radius * v;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    // labels
    ctx.fillStyle = labelColor;
    ctx.font = "11px Segoe UI, PingFang SC, Microsoft YaHei, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const a = angleAt(i);
      const x = cx + Math.cos(a) * (radius + 18);
      const y = cy + Math.sin(a) * (radius + 18);
      ctx.fillText(labels[i], x, y);
    }
  },

  roleMiniBars(radarObject) {
    const entries = Object.entries(radarObject || {});
    return entries
      .map(([k, v]) => {
        const pct = Math.max(0, Math.min(100, Number(v) || 0));
        return `<div class="mini-bar"><span class="mini-bar-label">${k}</span><div class="mini-bar-track"><i style="width:${pct}%"></i></div><span class="mini-bar-val">${pct}</span></div>`;
      })
      .join("");
  },
};
