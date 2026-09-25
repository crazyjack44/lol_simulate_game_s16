/* S16 Worlds Strategy Clash — static data & design constants */
window.S16 = window.S16 || {};

S16.REGIONS = {
  LPL: "LPL",
  LCK: "LCK",
  LEC: "LEC",
  LCS: "LCS",
};

/** 阵容体系（简化 BP） */
S16.LINEUPS = [
  {
    id: "meta",
    name: "版本常规",
    desc: "拿版本强势与扎实开团，收益稳定、上限有限。",
    bonus: 0.05,
    risk: "low",
    stat: "全阶段 +5% 战力",
  },
  {
    id: "signature",
    name: "招牌体系",
    desc: "围绕选手招牌英雄构建。达成体系联动后解锁强力团战技能，但怕被针对。",
    bonus: 0.1,
    risk: "mid",
    stat: "期望 +8~14%，联动 +3% 起",
  },
  {
    id: "offmeta",
    name: "冷门奇招",
    desc: "概率掏出冷门英雄/黑科技。命中则爆炸加成，落空则阵容别扭自减益。",
    bonus: 0,
    risk: "high",
    stat: "30% 大赚 / 40% 持平 / 30% 小亏",
  },
];

/** 团战风格 */
S16.STYLES = [
  { id: "engage", name: "强开团", desc: "寻找先手一锤定音。克制保护与分带犹豫。", icon: "⚔" },
  { id: "protect", name: "四保一", desc: "拖到大核成型。克制强开失败后的溃败局。", icon: "🛡" },
  { id: "split", name: "分带拉扯", desc: "边线施压换资源。克制笨重抱团阵容。", icon: "🗡" },
  { id: "teamfight", name: "正面团", desc: "小龙/大龙区域硬碰硬。克制过度分散的拉扯。", icon: "💥" },
];

/** 风格克制：key 克制 value */
S16.STYLE_COUNTER = {
  engage: "protect",
  protect: "teamfight",
  teamfight: "split",
  split: "engage",
};

/** 战术阶段（事件由程序按概率自主抽取） */
S16.PHASES = [
  {
    id: "early",
    name: "前期节奏",
    desc: "对线与野区的第一波设计",
    cards: [
      { id: "invade", name: "入侵野区", beats: "lane", eco: 12, desc: "进野反野，赌对面放空" },
      { id: "lane", name: "稳健上线", beats: "ambush", eco: 6, desc: "压刀换血，不给机会" },
      { id: "ambush", name: "集合埋伏", beats: "invade", eco: 18, desc: "草丛阴人，抓入侵" },
    ],
  },
  {
    id: "dragon",
    name: "小龙团",
    desc: "第一条关键资源争夺",
    cards: [
      { id: "rush", name: "速杀", beats: "wrap", eco: 16, desc: "直接开龙逼团" },
      { id: "wrap", name: "包抄", beats: "camp", eco: 22, desc: "绕后合围" },
      { id: "camp", name: "蹲伏", beats: "rush", eco: 20, desc: "卡视野反打" },
    ],
  },
  {
    id: "baron",
    name: "大龙团",
    desc: "胜负手资源团",
    cards: [
      { id: "rush", name: "速杀", beats: "wrap", eco: 28, desc: "拼惩戒一波" },
      { id: "wrap", name: "包抄", beats: "camp", eco: 24, desc: "大龙坑侧翼切入" },
      { id: "camp", name: "蹲伏", beats: "rush", eco: 26, desc: "假打真蹲" },
    ],
  },
];

S16.FACTOR_LABELS = {
  phase: "阶段基线",
  style: "风格倾向",
  economy: "经济差",
  power: "战力差",
  momentum: "动量/读牌",
  vs: "风格对位",
};

/** 英雄技能（阵容联动 / 团战自动释放） */
S16.HERO_SKILLS = {
  engage: { id: "engage", name: "强开先手", icon: "⚡", mult: 1.08, when: "先手" },
  focus: { id: "focus", name: "集火齐射", icon: "🎯", mult: 1.07, when: "隘口齐射" },
  protect: { id: "protect", name: "抬血保护", icon: "💚", mult: 1.05, when: "残局抬血" },
  roam: { id: "roam", name: "远程支援", icon: "🌪", mult: 1.06, when: "远程支援" },
  steal: { id: "steal", name: "偷龙窗口", icon: "🐉", mult: 1.1, when: "偷龙窗口" },
  harvest: { id: "harvest", name: "对线收割", icon: "🗡", mult: 1.04, when: "对线收割" },
};

/** 电竞梗/解说桥段：{p1} {p2} {team} {foe} {obj} —— 低频触发 */
S16.COMMENTARY = {
  engage: [
    "但是{p1}被定住了，追击有点难……",
    "{p1}天神下凡一锤四！这波直接扭转了局势！",
    "走位，{p1}！这都能开起来？",
    "{team}这波开团，像极了当年那个名场面。",
  ],
  steal: [
    "{p1}抢到了{obj}！那么局势要向{team}倾斜了……",
    "惩戒！{p1}抢到了！我的天！",
    "{obj}被{team}偷了，{foe}的节奏全乱了。",
  ],
  turn: [
    "{p1}扭转了局势！{team}这波打回来了！",
    "等等，{p1}还在操作！残血反杀不是梦！",
    "局势两极反转，{foe}前面的优势呢？",
  ],
  wipe: [
    "{team}一波带走！对面直接被团灭了！",
    "这就是运营吗？{foe}全员倒下，比赛悬念结束。",
    "打得好啊{team}！这局是他们的！",
  ],
  buff: [
    "拿下{obj}，{team}接下来要发力了。",
    "{obj}到手，地图上的声音都是{team}的。",
  ],
  misc: [
    "这波啊，这波是肉蛋葱鸡。",
    "这运营，有点像在下棋。",
    "懂的都懂，不懂的我也不多说了。",
    "你有什么头绪吗，{p1}？",
    "先相信，再质疑——哦现在可以相信了。",
    "一波一波，慢慢来，别急。",
  ],
};

S16.NARRATIVE = {
  invade: [
    "{team} 三人抱团入侵 {objective}，{player} 走在最前。",
    "{team} 摸进对面野区，{player} 的视野刚好没看到。",
  ],
  lane: [
    "{team} 稳健上线换血，{player} 补刀节奏完美。",
    "{team} 选择避战发育，把悬念留到资源团。",
  ],
  ambush: [
    "{team} 在河道草丛集合，{player} 已经按下了扫描。",
    "{team} 布下埋伏，等 {objective} 刷新的那一秒。",
  ],
  rush: [
    "{team} 直接开启 {objective}，{player} 负责卡住隘口。",
    "{team} 拼速度打 {objective}，对面不得不接。",
  ],
  wrap: [
    "{team} 分出侧翼包抄，{player} 绕到了后排。",
    "{team} 绕后合围，{objective} 成为诱饵。",
  ],
  camp: [
    "{team} 在 {objective} 附近蹲伏，{player} 屏息等待。",
    "{team} 假装露头，实则全员卡视野。",
  ],
};

S16.MARGIN_TEXT = {
  crush: "碾压",
  solid: "稳健",
  close: "胶着",
  comeback: "险胜",
};

/** 对局规则：每人复活 2 次（共 3 命）；一方全员阵亡则该局结束；赛事 BO5（先胜 3） */
S16.RULES = {
  revivesPerPlayer: 2,
  livesPerPlayer: 3, // 1 + revives
  teamSize: 5,
  series: "BO5",
  seriesWinsNeeded: 3,
  animateGames: 1, // 动画只播 1 局 BO1
};

/** 资源团胜方增益（用图标/颜色表示） */
S16.BUFFS = {
  dragon: {
    id: "dragon",
    name: "小龙增益",
    icon: "🐉",
    color: "#4a9eff",
    desc: "小龙团胜方 · 伤害 +8%",
    dmg: 1.08,
    eco: 1.02,
  },
  baron: {
    id: "baron",
    name: "大龙增益",
    icon: "👑",
    color: "#c868ff",
    desc: "大龙团胜方 · 伤害 +12% / 经济 +5%",
    dmg: 1.12,
    eco: 1.05,
  },
  elder: {
    id: "elder",
    name: "龙魂",
    icon: "✨",
    color: "#f0d27a",
    desc: "双龙会 · 伤害 +15%",
    dmg: 1.15,
    eco: 1.06,
  },
};

/** 把非标准 style 映射进四风格克制环 */
S16.normalizeStyle = function normalizeStyle(style) {
  const ring = ["engage", "protect", "split", "teamfight"];
  if (ring.includes(style)) return style;
  const alias = {
    gadget: "split",
    offmeta: "split",
    "protect-c": "protect",
    "bot-agro": "engage",
    "top-drive": "engage",
    "mid-carry": "teamfight",
    "split-push": "split",
  };
  return alias[style] || "teamfight";
};

/** 生成后由 applyRoster 合并；此处仅作文案/默认值 */
S16.TEAMS = [];

S16.applyRoster = function applyRoster() {
  const list = S16.ROSTER || [];
  S16.TEAMS = list.map((t) => {
    const power = Math.max(70, Math.min(96, t.power));
    return {
      ...t,
      power,
      style: S16.normalizeStyle(t.style),
      radarPower: t.radarPower,
      roster: t.roster || [],
      teamRadar: t.teamRadar || {},
    };
  });
  return S16.TEAMS;
};

// roster.js 加载后立即合并
if (S16.ROSTER) S16.applyRoster();
