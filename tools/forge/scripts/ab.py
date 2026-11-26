"""Gauntlet A/B packer: ab.py <id> <round> <ours_portrait> <ref_portrait> <ours_game> <ref_game> -> .research/gauntlet/<id>/round-<n>/{A,B}_{portrait,game}.png + key.json (random order, same for both views)"""
import json, os, random, sys
from PIL import Image
gid, rnd, op, rp, og, rg = sys.argv[1:7]
d = f".research/gauntlet/{gid}/round-{rnd}"
os.makedirs(d, exist_ok=True)
ours_is_a = random.random() < 0.5
def crop_game(p):
    im = Image.open(p).convert("RGB"); w, h = im.size
    return im.crop((w // 2 - 260, h // 2 - 260, w // 2 + 260, h // 2 + 260)).resize((1040, 1040), Image.LANCZOS)
def portrait(p):
    return Image.open(p).convert("RGB")
pairs = {"portrait": (portrait(op), portrait(rp)), "game": (crop_game(og), crop_game(rg))}
for view, (o, r) in pairs.items():
    a, b = (o, r) if ours_is_a else (r, o)
    a.save(f"{d}/A_{view}.png"); b.save(f"{d}/B_{view}.png")
json.dump({"A": "ours" if ours_is_a else "reference", "B": "reference" if ours_is_a else "ours"}, open(f"{d}.key.json", "w"))
print(d, "written")
