# -*- coding: utf-8 -*-
"""Extract S16 Worlds roster + latest-stage L1 radars into js/roster.js.

Sources (read-only):
  - data/rosters.json
  - D:/Python_work/lol-radar-titan/web/data/season_l1/<season>/{player,team,list.json}

Matching policy (do not loosen):
  1) normalized full name exact
  2) normalized startswith and length >= 3
  3) never bare `includes` on short tokens (gam/gen false positives)
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(r"C:\Users\14208\XiaomiMiMoProjects\s16lolgaming")
RADAR_ROOT = Path(r"D:\Python_work\lol-radar-titan\web\data\season_l1")
OUT = ROOT / "js" / "roster.js"

SEASONS = {
    "LPL": "LPL-2026-Split_3",
    "LCK": "LCK-2026-Rounds_3-4",
    "LEC": "LEC-2026-Summer",
    "LCS": "LCS-2026-Summer",
}

TEAMS = [
    ("GEN", "Gen.G Esports", "GEN", "LCK", "protect", "protect-c", ["金克丝", "悠米", "奥恩"], "#d4a843", "四保一体系成熟，拖后无解"),
    ("HLE", "Hanwha Life Esports", "HLE", "LCK", "engage", "top-drive", ["卡蜜尔", "蔚", "阿卡丽"], "#ff6a00", "上野强开，节奏凶悍"),
    ("T1", "T1", "T1", "LCK", "teamfight", "mid-carry", ["阿狸", "李青", "洛"], "#e2012d", "传奇中野，正面团与抓机会双修"),
    ("DK", "Dplus Kia", "DK", "LCK", "teamfight", "mid-carry", ["辛德拉", "瑟庄妮", "韦鲁斯"], "#00a6ff", "中路压制，资源团站位扎实"),
    ("AL", "Anyone's Legend", "AL", "LPL", "split", "split-push", ["纳尔", "佛耶戈", "卡莎"], "#ff8c00", "边线施压，野区节奏多变"),
    ("BLG", "Bilibili Gaming", "BLG", "LPL", "engage", "bot-agro", ["卡莉丝塔", "诺提勒斯", "贾克斯"], "#00a1d6", "下路强打线，滚雪球能力顶级"),
    ("TES", "Top Esports", "TES", "LPL", "teamfight", "mid-carry", ["阿卡丽", "佛耶戈", "德莱文"], "#e4002b", "进攻火力猛，一波流团战"),
    ("IG", "Invictus Gaming", "IG", "LPL", "engage", "top-drive", ["杰斯", "奈德丽", "乐芙兰"], "#c8aa6e", "对线凶悍，前期碰撞多"),
    ("TL", "Team Liquid", "TL", "LCS", "protect", "protect-c", ["赛娜", "塔姆", "奥恩"], "#0a1e3c", "北美之光，体系扎实略慢热"),
    ("C9", "Cloud9", "C9", "LCS", "split", "offmeta", ["吉格斯", "伊泽瑞尔", "布隆"], "#00aeef", "BP灵活，奇招偷龙名场面"),
    ("G2", "G2 Esports", "G2", "LEC", "split", "offmeta", ["吉格斯", "赛娜", "派克"], "#ee3d3d", "战术奇招多，冷门英雄概率高"),
    ("KOI", "Movistar KOI", "KOI", "LEC", "teamfight", "mid-carry", ["维克托", "嘉文四世", "烬"], "#e30613", "欧洲黑马，团战理解好"),
    ("KC", "Karmine Corp", "KC", "LEC", "split", "split-push", ["青钢影", "希维尔", "塔姆"], "#2e7dff", "边线野性十足"),
    ("LYON", "LYON", "LYON", "LCS", "engage", "bot-agro", ["卡莎", "蔚", "阿狸"], "#00c2ff", "拉美劲旅，前期设计多"),
    ("FLY", "FlyQuest", "FLY", "LCS", "protect", "protect-c", ["奥恩", "盲僧", "霞"], "#00ff9c", "北美稳健运营"),
    ("SR", "Sentinels", "SR", "LCS", "split", "split-push", ["剑姬", "赵信", "阿狸"], "#c39c62", "游击拉扯，边线施压"),
]

TEAM_ALIASES = {
    "GEN": ["Gen.G", "Gen.G Esports", "GEN", "GenG"],
    "HLE": ["Hanwha Life Esports", "Hanwha Life", "HLE"],
    "T1": ["T1"],
    "DK": ["Dplus Kia", "Dplus KIA", "Dplus", "DWG KIA", "DK"],
    "AL": ["Anyone's Legend", "Anyone’s Legend", "AL"],
    "BLG": ["Bilibili Gaming", "BLG"],
    "TES": ["Top Esports", "TES"],
    "IG": ["Invictus Gaming", "iG", "IG"],
    "TL": ["Team Liquid", "TL"],
    "C9": ["Cloud9", "C9"],
    "G2": ["G2 Esports", "G2"],
    "KOI": ["Movistar KOI", "KOI"],
    "KC": ["Karmine Corp", "KC"],
    "LYON": ["LYON", "Lyon", "Team LYON"],
    "FLY": ["FlyQuest", "FLY", "Fly Quest"],
    "SR": ["Sentinels", "SR"],
}

STATIC_POWER = {
    "GEN": 93, "HLE": 88, "T1": 94, "DK": 86,
    "AL": 82, "BLG": 92, "TES": 90, "IG": 84,
    "TL": 83, "C9": 81, "G2": 87, "KOI": 80, "KC": 82,
    "LYON": 78, "FLY": 79, "SR": 77,
}

POS = ["top", "jng", "mid", "bot", "sup"]
POS_CN = {"top": "上单", "jng": "打野", "mid": "中单", "bot": "下路", "sup": "辅助"}
POS_ALIASES = {
    "top": "top", "jgl": "jng", "jng": "jng", "jungle": "jng",
    "mid": "mid", "bot": "bot", "adc": "bot",
    "sup": "sup", "support": "sup",
}

TEAM_DIM_ORDER = [
    ("d_kills", "交战"),
    ("d_assists", "协同助攻"),
    ("d_kp", "流动性"),
    ("d_burst", "瞬时处理"),
    ("d_economy", "资源转化"),
    ("d_survival", "心性"),
    ("d_lane", "主导占比"),
    ("d_vision", "视野压制"),
]

LOGO_MAP = {
    "GEN": "Gen.G_Esports.png",
    "HLE": "Hanwha_Life_Esports.png",
    "T1": "T1.png",
    "DK": "Dplus.png",
    "AL": "Anyones_Legend.png",
    "BLG": "Bilibili_Gaming.png",
    "TES": "Top_Esports.png",
    "IG": "Invictus_Gaming.png",
    "TL": "Team_Liquid.png",
    "C9": "Cloud9.png",
    "G2": "G2_Esports.png",
    "KOI": "Movistar_KOI.webp",
    "KC": "Karmine_Corp.png",
    "LYON": "LYON.png",
    "FLY": "FlyQuest.png",
    "SR": "Sentinels.png",
}


def norm_key(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).strip().lower()
    s = s.replace("’", "'").replace("`", "'")
    return re.sub(r"[^a-z0-9一-鿿]+", "", s)


def norm_pos(p):
    return POS_ALIASES.get((p or "").strip().lower())


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dims_to_radar(obj: dict) -> dict:
    out = {}
    for d in obj.get("dimensions") or []:
        label = d.get("label") or d.get("key")
        out[label] = int(d.get("value", 50))
    return out


def top_score(obj: dict, fallback=1500.0) -> float:
    ts = obj.get("top_stats") or {}
    if isinstance(ts, dict):
        v = ts.get("text_score")
        if isinstance(v, dict):
            try:
                return float(v.get("value", fallback))
            except Exception:
                return fallback
        if isinstance(v, (int, float)):
            return float(v)
    return fallback


def names_match(a: str, b: str) -> int:
    """0 no, 1 prefix, 2 exact. Prefer exact."""
    na, nb = norm_key(a), norm_key(b)
    if not na or not nb:
        return 0
    if na == nb:
        return 2
    if len(na) >= 3 and (na.startswith(nb) or nb.startswith(na)):
        return 1
    return 0


def photo_path(player_name: str, file_hint: str | None) -> str | None:
    assets = ROOT / "assets" / "players"
    candidates = []
    if file_hint:
        candidates.append(file_hint)
    candidates += [f"{player_name}.png", f"{player_name}.jpg", f"{player_name}.jpeg"]
    for c in candidates:
        if (assets / c).is_file():
            return f"assets/players/{c}"
    nn = norm_key(player_name)
    for p in assets.iterdir():
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} and norm_key(p.stem) == nn:
            return f"assets/players/{p.name}"
    return None


def player_id_to_file(pid: str) -> str:
    return pid.replace(":", "_") + ".json"


def scan_seasons():
    """Load all player/team JSON blobs keyed by season."""
    players_by_season = {}
    teams_by_season = {}
    list_by_season = {}
    for league, season in SEASONS.items():
        base = RADAR_ROOT / season
        if not base.is_dir():
            continue
        players_by_season[season] = []
        teams_by_season[season] = []
        pdir = base / "player"
        if pdir.is_dir():
            for fn in pdir.glob("*.json"):
                try:
                    players_by_season[season].append(load_json(fn))
                except Exception:
                    pass
        tdir = base / "team"
        if tdir.is_dir():
            for fn in tdir.glob("*.json"):
                try:
                    teams_by_season[season].append(load_json(fn))
                except Exception:
                    pass
        lp = base / "list.json"
        if lp.is_file():
            list_by_season[season] = load_json(lp)
    return players_by_season, teams_by_season, list_by_season


def team_name_of_player(pobj: dict, list_by_season, season: str) -> str:
    tags = pobj.get("tags") or []
    name = pobj.get("name") or ""
    # list.json is authoritative
    info = list_by_season.get(season) or {}
    for row in info.get("players") or []:
        if names_match(row.get("name"), name) == 2:
            return row.get("team_name") or ""
    for t in tags:
        lab = t.get("label") or ""
        if lab in POS_CN.values() or lab in POS or lab in SEASONS:
            continue
        if lab in ("选手", "队伍"):
            continue
        return lab
    raw = pobj.get("raw") or {}
    return raw.get("team_name") or ""


def position_of_player(pobj: dict, list_by_season, season: str) -> str | None:
    name = pobj.get("name") or ""
    info = list_by_season.get(season) or {}
    for row in info.get("players") or []:
        if names_match(row.get("name"), name) == 2:
            return norm_pos(row.get("position"))
    for t in pobj.get("tags") or []:
        pos = norm_pos(t.get("label"))
        if pos:
            return pos
        lab = t.get("label") or ""
        for code, cn in POS_CN.items():
            if lab == cn:
                return code
    return None


def resolve_team_gid(team_name: str) -> str | None:
    best_gid, best = None, 0
    for gid, aliases in TEAM_ALIASES.items():
        for a in aliases:
            m = names_match(team_name, a)
            if m > best:
                best, best_gid = m, gid
            if m == 2:
                return gid
    return best_gid if best else None


def fallback_player_radar(pos: str, seed: int) -> dict:
    base = {
        "风格化压制": 56, "可获发育": 58, "交战": 55, "击杀参与": 57,
        "输出占比": 54, "瞬时处理": 56, "资源转化": 56, "生存能力": 55,
    }
    shift = (seed % 9) - 4
    return {k: max(35, min(95, v + shift)) for k, v in base.items()}


def fallback_team_radar(seed: int) -> dict:
    labels = [lab for _, lab in TEAM_DIM_ORDER]
    return {lab: 56 + ((seed + i * 3) % 11) for i, lab in enumerate(labels)}


def build_worlds_desired():
    """From rosters.json: gid -> pos -> {name, file, starter}."""
    data = load_json(ROOT / "data" / "rosters.json")
    out = defaultdict(dict)
    for p in data.get("players") or []:
        gid = resolve_team_gid(p.get("team") or "")
        if not gid:
            continue
        pos = norm_pos(p.get("position"))
        if not pos:
            continue
        cur = out[gid].get(pos)
        cand = {
            "name": p.get("player") or "",
            "file": p.get("file"),
            "starter": bool(p.get("starter", True)),
            "has_image": bool(p.get("has_image")),
        }
        if not cur:
            out[gid][pos] = cand
        else:
            # prefer starter, then has_image, then lexicographic for stability
            better = (
                (cand["starter"], cand["has_image"], cand["name"] > cur["name"])
                > (cur["starter"], cur["has_image"], False)
            )
            # keep existing unless cand is starter and cur is not
            if cand["starter"] and not cur["starter"]:
                out[gid][pos] = cand
    return out


def pick_by_score(rows, pos):
    cands = [r for r in rows if r.get("position") == pos]
    if not cands:
        return None
    cands.sort(key=lambda r: r.get("score") or 0, reverse=True)
    return cands[0]


def main():
    players_by_season, teams_by_season, list_by_season = scan_seasons()
    desired = build_worlds_desired()

    # index players globally by season
    season_rows = {}  # season -> list of {name, position, team, score, radar, id}
    for season, plist in players_by_season.items():
        rows = []
        for pobj in plist:
            name = pobj.get("name") or ""
            pos = position_of_player(pobj, list_by_season, season)
            team = team_name_of_player(pobj, list_by_season, season)
            rows.append({
                "name": name,
                "position": pos,
                "team": team,
                "score": top_score(pobj, 1500),
                "radar": dims_to_radar(pobj),
                "id": pobj.get("id"),
                "season": season,
            })
        season_rows[season] = rows

    team_rows = {}  # season -> list of {name, radar, score, id}
    for season, tlist in teams_by_season.items():
        rows = []
        for tobj in tlist:
            radar = dims_to_radar(tobj)
            if radar and all(k.startswith("d_") for k in radar):
                keymap = dict(TEAM_DIM_ORDER)
                radar = {keymap.get(k, k): v for k, v in radar.items()}
            rows.append({
                "name": tobj.get("name") or "",
                "radar": radar,
                "score": top_score(tobj, 1500),
                "id": tobj.get("id"),
                "season": season,
            })
        team_rows[season] = rows

    teams_out = []
    for tid, name, short, region, style, signature, heroes, color, note in TEAMS:
        aliases = TEAM_ALIASES[tid]
        league = region
        preferred = SEASONS[league]
        logo = f"assets/teams/{LOGO_MAP[tid]}" if LOGO_MAP.get(tid) else None
        if logo and not (ROOT / logo).is_file():
            logo = None

        # --- players ---
        roster = []
        scores = []
        if tid in desired:
            for pos in POS:
                meta = desired[tid].get(pos) or {"name": f"{short}{pos}", "file": None}
                handle = meta["name"]
                # find matching player in preferred season, else any
                found = None
                found_season = preferred
                for season in [preferred] + [s for s in SEASONS.values() if s != preferred]:
                    rows = season_rows.get(season) or []
                    # prefer same team
                    best = None
                    best_m = 0
                    for r in rows:
                        if r["position"] != pos:
                            continue
                        m = names_match(r["name"], handle)
                        if m == 2 and resolve_team_gid(r["team"]) == tid:
                            best, best_m = r, 3
                            break
                        if m == 2 and m > best_m:
                            best, best_m = r, m
                        elif m == 1 and best_m < 1:
                            best, best_m = r, m
                    if best and best_m >= 1:
                        found, found_season = best, season
                        break
                if found:
                    radar = found["radar"] or fallback_player_radar(pos, hash(handle) % 97)
                    score = found["score"]
                    source = "season_l1"
                    pid = found["id"]
                else:
                    radar = fallback_player_radar(pos, hash(handle) % 97)
                    score = 1400 + (STATIC_POWER[tid] - 85) * 4
                    source = "fallback impression"
                    pid = None
                photo = photo_path(handle, meta.get("file")) or logo
                roster.append({
                    "pos": pos,
                    "posCn": POS_CN[pos],
                    "id": pid or f"p:{tid}:{pos}",
                    "name": handle,
                    "photo": photo,
                    "radar": radar,
                    "radarPower": round(sum(radar.values()) / max(1, len(radar)), 2),
                    "textScore": score,
                    "season": found_season,
                    "source": source,
                    "starter": meta.get("starter", True),
                })
                scores.append(score)
        else:
            # fill team: top score per position in preferred season
            rows = season_rows.get(preferred) or []
            team_hit = []
            for r in rows:
                if resolve_team_gid(r["team"]) == tid or any(names_match(r["team"], a) for a in aliases):
                    team_hit.append(r)
            if not team_hit:
                # LCS fill teams may use exact names
                for r in rows:
                    if any(names_match(r["team"], a) == 2 for a in aliases):
                        team_hit.append(r)
            for pos in POS:
                best = pick_by_score(team_hit, pos)
                if best:
                    radar = best["radar"] or fallback_player_radar(pos, hash(best["name"]) % 97)
                    handle = best["name"]
                    score = best["score"]
                    source = "season_l1"
                    pid = best["id"]
                    season = preferred
                else:
                    radar = fallback_player_radar(pos, hash(tid + pos) % 97)
                    handle = f"{short}{pos}"
                    score = 1400 + (STATIC_POWER[tid] - 85) * 4
                    source = "fallback impression"
                    pid = None
                    season = preferred
                roster.append({
                    "pos": pos,
                    "posCn": POS_CN[pos],
                    "id": pid or f"p:{tid}:{pos}",
                    "name": handle,
                    "photo": photo_path(handle, None) or logo,
                    "radar": radar,
                    "radarPower": round(sum(radar.values()) / max(1, len(radar)), 2),
                    "textScore": score,
                    "season": season,
                    "source": source,
                    "starter": True,
                })
                scores.append(score)

        # --- team radar ---
        team_radar = None
        t_source = "fallback impression"
        for season in [preferred] + [s for s in SEASONS.values() if s != preferred]:
            for t in team_rows.get(season) or []:
                if any(names_match(t["name"], a) >= 1 for a in aliases):
                    if t["radar"]:
                        team_radar = t["radar"]
                        t_source = "season_l1"
                        break
            if team_radar:
                break
        if not team_radar:
            team_radar = fallback_team_radar(hash(tid) % 97)

        avg_role_score = (sum(scores) / len(scores)) if scores else 1400
        # map text_score (~1100-1900) into 70-96 band
        radar_power = round(70 + (avg_role_score - 1100) / 800 * 26, 1)
        radar_power = max(70.0, min(96.0, radar_power))
        power = max(70.0, min(96.0, radar_power + (STATIC_POWER[tid] - 85) * 0.15))

        teams_out.append({
            "id": tid,
            "name": name,
            "short": short,
            "region": region,
            "power": round(power, 2),
            "style": style,
            "signature": signature,
            "heroes": heroes,
            "color": color,
            "note": note,
            "logo": logo,
            "roster": roster,
            "teamRadar": team_radar,
            "radarPower": radar_power,
            "avgRoleScore": round(avg_role_score, 1),
            "dataSource": t_source,
            "season": preferred,
            "rosterSource": "worlds_s16" if tid in desired else "lcs_fill",
        })

    # print summary
    t1 = next(t for t in teams_out if t["id"] == "T1")
    print("T1:", [(p["pos"], p["name"], p["source"], p["textScore"]) for p in t1["roster"]])
    print("teams", len(teams_out))
    missing_photo = [(t["id"], p["name"]) for t in teams_out for p in t["roster"] if not p["photo"]]
    print("missing_photos", len(missing_photo), missing_photo[:10])
    fb = [(t["id"], p["name"], p["pos"]) for t in teams_out for p in t["roster"] if p["source"] != "season_l1"]
    print("non_season_players", len(fb), fb)
    for t in teams_out:
        names = [p["name"] for p in t["roster"]]
        print(f"{t['id']:4} power={t['power']:5.1f} radarPower={t['radarPower']:5.1f} {names} teamRadar_src={t['dataSource']}")

    payload_note = "season_l1 latest + data/rosters.json; do not hand-edit"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/* S16 roster generated by scripts/extract_roster.py — do not hand-edit */\n"
        "window.S16 = window.S16 || {};\n"
        f"S16.ROSTER_SOURCE = {json.dumps(payload_note, ensure_ascii=False)};\n"
        f"S16.ROSTER_SEASONS = {json.dumps(SEASONS, ensure_ascii=False)};\n"
        f"S16.ROSTER = {json.dumps(teams_out, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
