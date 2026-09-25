# -*- coding: utf-8 -*-
"""Copy S16 visual assets and roster source into the s16lolgaming project."""
import json
import os
import shutil
from pathlib import Path

ROOT = Path(r"C:\Users\14208\XiaomiMiMoProjects\s16lolgaming")
PLAYERS_SRC = Path(r"D:\Python_work\lol-radar-titan\web\assets\img\worlds_s16")
TEAMS_SRC = Path(r"D:\Python_work\lol_web\assets\teams")
CHAMPS_SRC = Path(r"D:\Python_work\lol_web\assets\champion_icons")

for d in (
    ROOT / "assets" / "players",
    ROOT / "assets" / "teams",
    ROOT / "assets" / "champions",
    ROOT / "data",
    ROOT / "js",
    ROOT / "css",
    ROOT / "scripts",
):
    d.mkdir(parents=True, exist_ok=True)

# 1) rosters.json
shutil.copy2(PLAYERS_SRC / "rosters.json", ROOT / "data" / "rosters.json")
print("copied rosters.json")

# 2) player images
rosters = json.loads((ROOT / "data" / "rosters.json").read_text(encoding="utf-8"))
player_files = set()
for p in rosters.get("players", []):
    f = p.get("file")
    if f:
        player_files.add(f)
# also copy any image in source (benches / extras)
for f in PLAYERS_SRC.iterdir():
    if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        player_files.add(f.name)

n_players = 0
for name in sorted(player_files):
    src = PLAYERS_SRC / name
    if src.is_file():
        shutil.copy2(src, ROOT / "assets" / "players" / name)
        n_players += 1
print("players copied", n_players)

# 3) team logos — map S16 teams
TEAM_LOGO_MAP = {
    "Gen.G Esports": "KOREA__Gen.G_Esports.png",
    "Hanwha Life Esports": "KOREA__Hanwha_Life_Esports.png",
    "T1": "KOREA__T1.png",
    "Dplus": "KOREA__Dplus_KIA.png",
    "Dplus Kia": "KOREA__Dplus_KIA.png",
    "Dplus KIA": "KOREA__Dplus_KIA.png",
    "Anyone's Legend": "CHINA__Anyone's_Legend.png",
    "Bilibili Gaming": "CHINA__BILIBILI_GAMING.png",
    "Top Esports": "CHINA__TOP_ESPORTS.png",
    "Invictus Gaming": "CHINA__Invictus_Gaming.png",
    "Team Liquid": "NORTH_AMERICA__Team_Liquid_Alienware.png",
    "Cloud9": "NA__Cloud9_Kia.png",
    "G2 Esports": "EMEA__G2_Esports.png",
    "Movistar KOI": "EMEA__Gentle_Mates.png",  # placeholder, fixed below if better exists
    "Karmine Corp": "EMEA__Karmine_Corp.png",
    "LYON": "LATIN_AMERICA__Kaos_Latin_Gamers.png",  # fallback if no LYON logo
    "FlyQuest": "NA__FlyQuest.png",
    "Sentinels": "NA__Sentinels.png",
}

# Prefer exact/partial name matches from source for teams missing a good map
def find_logo(team_name: str) -> Path | None:
    if team_name in TEAM_LOGO_MAP:
        p = TEAMS_SRC / TEAM_LOGO_MAP[team_name]
        if p.is_file():
            return p
    keys = [
        team_name.lower().replace(" ", "").replace("'", "").replace(".", ""),
        team_name.split()[0].lower(),
    ]
    best = None
    for f in TEAMS_SRC.iterdir():
        if f.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        stem = f.stem.lower().replace(" ", "").replace("_", "").replace("'", "").replace(".", "")
        for k in keys:
            if k and k in stem:
                return f
        # KOI / Movistar
        if "koi" in team_name.lower() and "koi" in stem:
            best = f
        if "lyon" in team_name.lower() and "lyon" in stem:
            best = f
        if "flyquest" in team_name.lower() and "flyquest" in stem:
            best = f
        if "sentinel" in team_name.lower() and "sentinel" in stem:
            best = f
    return best


# Explicit better names discovered in source
EXTRA_SEARCH = {
    "Movistar KOI": ["koi", "movistar"],
    "LYON": ["lyon"],
    "FlyQuest": ["flyquest", "fly_quest"],
    "Sentinels": ["sentinel"],
    "Dplus": ["dplus", "dk"],
    "Cloud9": ["cloud9"],
    "Team Liquid": ["team_liquid", "liquid"],
}

def find_logo_v2(team_name: str) -> Path | None:
    if team_name in TEAM_LOGO_MAP:
        p = TEAMS_SRC / TEAM_LOGO_MAP[team_name]
        if p.is_file() and "Gentle_Mates" not in p.name and "Kaos" not in p.name:
            return p
        if p.is_file() and team_name in ("Gen.G Esports", "Hanwha Life Esports", "T1",
                                          "Anyone's Legend", "Bilibili Gaming", "Top Esports",
                                          "Invictus Gaming", "G2 Esports", "Karmine Corp"):
            return p
    needles = EXTRA_SEARCH.get(team_name, [])
    if not needles:
        needles = [team_name.lower().replace(" ", "_").replace("'", "")]
    candidates = []
    for f in TEAMS_SRC.iterdir():
        if f.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        stem = f.stem.lower().replace(" ", "_")
        for n in needles:
            n2 = n.lower().replace(" ", "_")
            if n2 in stem:
                candidates.append(f)
                break
    # prefer shorter stem (more exact)
    if candidates:
        candidates.sort(key=lambda p: (len(p.stem), p.stem))
        return candidates[0]
    return find_logo(team_name)


team_names = sorted({p["team"] for p in rosters.get("players", [])})
# also fill teams we will add
team_names += ["LYON", "FlyQuest", "Sentinels", "Dplus Kia"]
team_names = list(dict.fromkeys(team_names))

logo_report = []
n_logos = 0
for t in team_names:
    src = find_logo_v2(t)
    if src:
        dest = ROOT / "assets" / "teams" / f"{t.replace(' ', '_').replace(chr(39), '')}{src.suffix.lower()}"
        shutil.copy2(src, dest)
        n_logos += 1
        logo_report.append((t, src.name, dest.name))
    else:
        logo_report.append((t, None, None))
print("team logos copied", n_logos)
for row in logo_report:
    print(" ", row)

# 4) champion icons — copy all (needed for hero pool); keep original filenames
n_champs = 0
for f in CHAMPS_SRC.iterdir():
    if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        shutil.copy2(f, ROOT / "assets" / "champions" / f.name)
        n_champs += 1
print("champions copied", n_champs)

# 5) verify dimensions of a sample
from PIL import Image

def check(img_path: Path, min_w=64):
    try:
        im = Image.open(img_path)
        w, h = im.size
        return w >= min_w and h >= min_w, im.size, im.mode
    except Exception as e:
        return False, str(e), None

print("--- verify ---")
samples = [
    ROOT / "assets" / "players" / "Faker.png",
    ROOT / "assets" / "players" / "JackeyLove.jpg",
]
for t, src, dest in logo_report:
    if dest:
        samples.append(ROOT / "assets" / "teams" / dest)
# a few champs
champs = list((ROOT / "assets" / "champions").glob("*.png"))[:3]
samples.extend(champs)
ok = 0
for s in samples:
    if s and s.is_file():
        good, size, mode = check(s)
        print(("OK" if good else "BAD"), s.name, size, mode)
        if good:
            ok += 1
print("verified_ok", ok, "/", len(samples))

# summary json for later stages
summary = {
    "players": n_players,
    "logos": n_logos,
    "champions": n_champs,
    "logo_map": {t: dest for t, _s, dest in logo_report},
}
(ROOT / "data" / "assets_manifest.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("wrote data/assets_manifest.json")
