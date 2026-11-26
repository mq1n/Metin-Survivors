"""Build pipeline: render -> WAV (float32, .research/audio/wav) -> MP3 (+loudness/peak guard) -> hashed names -> manifest part.

    python -m audiogen.build sfx              # render all SFX WAVs
    python -m audiogen.build music            # render all music WAVs
    python -m audiogen.build encode           # encode every WAV to MP3, hash, write manifest/audio.json + qa data
    python -m audiogen.build all
    options: --only <substring>  (filter ids), --jobs N

Staged (nothing under apps/game/public is written; WP AG-01): the hashed MP3s mirror the public layout under the stage dir
(default .research/audio/stage: assets/audio/<kind>/<id>.<hash>.mp3) and the manifest entries go to <stage>/manifest/audio.part.json
(merged by id), the encode metadata to <stage>/encode.json; `python -m audiogen.qa --stage` measures and judges them.
    python -m audiogen.build ambience                 # render the four zone beds (amb_*) to .research/audio/wav/ambience
    python -m audiogen.build ambience --stage         # ... and encode them staged (56 kbps mono CBR, loop seam search)
    python -m audiogen.build encode --stage [DIR] --only <substring> [--kbps N]   # staged encode of already rendered WAVs

Calm / combat stems (WP AG-02): every zone song module carries a CALM spec (songs/<zone>.py, applied by music.apply_calm): the very same Song
(same notes, tempo, bars, key, rng draws) with the percussion and brass lifted out and the lead softened, mastered CALM_OFFSET_DB under the
combat mix. mus_<zone> (the full mix) is the combat stem; mus_<zone>_calm is its own file of exactly the same sample count, so the runtime can
cross-fade the two in sync. "In sync" means sample-aligned: the lead softening of the calm variant is a ZERO-PHASE filter on the track buffer
(music.soften_zero_phase), not a causal biquad in the track EQ (those delayed the softened voices by 3-4 samples = a partial comb in the cross-fade);
stage_zone_stems proves it on the decoded MP3s (music.stem_alignment: lag 0 in 300-1500 Hz and 1500-6000 Hz, |lag| <= 1 in 40-300 Hz). Once a calm WAV exists `encode` no longer aliases mus_<zone>_calm to mus_<zone>.
    python -m audiogen.build calm [--only <zone>] [--check-combat]          # render mus_<zone>_calm WAVs (.research/audio/wav/music)
    python -m audiogen.build calm --stage [DIR] [--only <zone>]             # ... and encode them staged: hashed MP3s, mus_<zone>_combat alias,
                                                                           # <stage>/stems.json (length, level and seam proof of every calm / combat pair)

Zone boss themes (WP AG-03): songs/boss.py build(zone) is the shared boss song with the zone's lead voice and motif over it (mus_<zone>_boss,
sample-exact the length of mus_boss, mastered to the same -16 LUFS). Once a variant WAV exists `encode` no longer aliases mus_<zone>_boss to mus_boss.
    python -m audiogen.build boss [--only <zone>] [--check-base]           # render mus_<zone>_boss WAVs (.research/audio/wav/music); --check-base also
                                                                           # re-renders the untouched boss song and compares it with mus_boss.wav
    python -m audiogen.build boss --stage [DIR] [--only <zone>]            # ... and encode them staged: hashed MP3s, <stage>/boss.json (length, level, seam proof)
A looping SFX of kind ambience (sfx_lava_bubble_loop) is staged by `encode --stage --only <id>` through the same seam-searching loop encoder as the
zone beds (mono CBR SFX_LOOP_KBPS, the loop is re-cut at its quietest wrap point), so it passes the qa.py seam limits.

The full `encode` (do_encode -> encode_catalogue) routes every asset the way the stage does, so the public files are the staged ones, byte for byte:
  * every looping SONG goes through encode_music_loop_staged (the shortest of SEAM_FADES_MS whose decoded MP3 has a clean seam; 0 ms when the plain
    encode is already clean, so mus_menu / mus_yeonmu / mus_boss keep their bytes). The re-rendered mus_suryeon needs the 1 ms edge fade: moving the
    Intro strikes off the wrap (songs/suryeon.py DOWNBEAT_LAG) is not enough on its own - the plain MP3 encode of that WAV still measures seam step
    0.225 / HF x2.338 - and the fade brings the decoded seam to 0.043 / 0.057. mus_seori (0.322 -> 0.017) and mus_daeryeol (0.364 / 1.908 -> 0.031 /
    0.469) get the same 1 ms fade, which brings their seams under the qa limits too;
  * the calm stems and the zone boss variants as before (encode_calm_stems, encode_boss_stems);
  * the ambience SFX loops listed in RECUT_LOOP_SFX (sfx_lava_bubble_loop: plain encode = seam step 0.508) through the seam-searching loop encoder,
    every other SFX (sfx_fire_burn_loop included) through the plain encoder, unchanged;
  * the four zone beds (amb_*, rendered by `ambience`) through encode_loop_staged at AMBIENCE_KBPS into assets/audio/ambience, listed in manifest/audio.json.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from . import dsp, music
from .dsp import SR

ROOT = Path(__file__).resolve().parents[3]
PUB = ROOT / "apps" / "game" / "public"
AUDIO_DIR = PUB / "assets" / "audio"
MANIFEST = PUB / "assets" / "manifest" / "audio.json"
WORK = ROOT / ".research" / "audio"
WAV_DIR = WORK / "wav"
QA_JSON = WORK / "qa.json"
STAGE_DIR = WORK / "stage"
AMB_WAV_DIR = WAV_DIR / "ambience"

SFX_MODULES = ["sfx_combat", "sfx_magic", "sfx_world", "sfx_ui", "sfx_boss", "sfx_extra"]
SONGS = ["menu", "yeonmu", "suryeon", "seori", "daeryeol", "boss", "victory", "defeat"]
ZONE_SONGS = ["yeonmu", "suryeon", "seori", "daeryeol"]
SFX_ALIASES = {"sfx_metin_warn": "sfx_metin_warning", "sfx_metin_break": "sfx_metin_shatter"}
SFX_PEAK_DB = -1.3  # pre-encode peak; verified/adjusted so the *decoded mp3* is <= -1.0 dBFS
MUSIC_LUFS = -16.0  # every music loop / stinger is mastered to this integrated loudness (for a zone loop: the combat mix)
CALM_OFFSET_DB = -2.0  # AG-02: the calm variant of a zone loop sits this far under its combat mix (integrated LUFS)
CALM_TOL_DB = 0.5  # ... within this, measured on the decoded MP3s
BOSS_TOL_DB = 0.5  # AG-03: a zone boss theme is mastered to MUSIC_LUFS like the shared one, within this (decoded MP3s)
SFX_LOOP_KBPS = 96  # AG-03: staged looping ambience SFX (mono CBR): the 4.8 s lava loop = ~58 kB
RECUT_LOOP_SFX = ("sfx_lava_bubble_loop",)  # AG-03: looping ambience SFX encoded with the seam-searching loop encoder (the plain encode of the lava loop has a 0.508 seam step)
MP3_Q_SFX = 4
MP3_Q_MUSIC = 4
FFMPEG = "ffmpeg"


# --------------------------------------------------------------------------- registry helpers
def load_sfx():
    from . import sfx_lib

    for m in SFX_MODULES:
        importlib.import_module(f"audiogen.{m}")
    return sfx_lib.REG


def sfx_files():
    from . import sfx_lib

    reg = load_sfx()
    out = []
    for d in reg.values():
        for i, fid in enumerate(sfx_lib.file_ids(d)):
            out.append((fid, d.id, i))
    return out


# --------------------------------------------------------------------------- render
def _write_wav(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(path), SR, np.asarray(x.T if x.ndim == 2 else x, dtype=np.float32))


def render_sfx_one(args):
    fid, gid, idx = args
    from . import sfx_lib

    load_sfx()
    d = sfx_lib.REG[gid]
    t = time.time()
    x = np.asarray(d.fn(idx), dtype=float)
    if d.loop:
        x = x - x.mean(axis=-1, keepdims=True)  # exactly periodic signals: the mean over one period is the DC offset
        x = x * (dsp.db2lin(SFX_PEAK_DB) / (np.abs(x).max() + 1e-12))
    else:
        pk = np.abs(x).max()
        x = x * (dsp.db2lin(SFX_PEAK_DB) / (pk + 1e-12))
    if not np.all(np.isfinite(x)):
        raise RuntimeError(f"{fid}: non-finite samples")
    _write_wav(WAV_DIR / "sfx" / f"{fid}.wav", x)
    return fid, x.shape[-1] / SR, time.time() - t


def render_song_one(name):
    mod = importlib.import_module(f"audiogen.songs.{name}")
    t = time.time()
    S = mod.build()
    loop = getattr(mod, "LOOP", True)
    x = S.render(loop=loop)
    if loop:
        y, info = music.master_loop(x, MUSIC_LUFS, -1.5)
    else:
        y, info = music.master_oneshot(x, MUSIC_LUFS, -1.5)
    _write_wav(WAV_DIR / "music" / f"{mod.ID}.wav", y)
    meta = dict(id=mod.ID, name=name, loop=loop, bpm=S.bpm, bars=S.bars, duration=y.shape[-1] / SR, samples=int(y.shape[-1]), **info, render_s=time.time() - t)
    (WAV_DIR / "music" / f"{mod.ID}.json").write_text(json.dumps(meta, indent=1))
    return meta


def calm_id(zone: str) -> str:
    return f"mus_{zone}_calm"


def render_calm_one(args):
    """The calm variant of one zone loop: the SAME Song (same build(), same rng draws) with the percussion / brass lifted out and the lead
    softened (music.apply_calm with the module's CALM spec), through the same master chain, CALM_OFFSET_DB under the combat loudness.
    check_combat also renders the untouched mix of that Song and compares it with the rendered combat WAV (mus_<zone>.wav): the proof
    that mus_<zone> really is the full mix the calm stem was cut from."""
    name, check_combat = args
    mod = importlib.import_module(f"audiogen.songs.{name}")
    spec = getattr(mod, "CALM", None)
    if spec is None:
        raise SystemExit(f"songs/{name}.py has no CALM spec")
    t = time.time()
    S = mod.build()
    combat_meta_path = WAV_DIR / "music" / f"{mod.ID}.json"
    combat_meta = json.loads(combat_meta_path.read_text()) if combat_meta_path.exists() else None
    combat_check = None
    if check_combat:
        yc, _ = music.master_loop(S.render(loop=True), MUSIC_LUFS, -1.5)  # render() leaves the track buffers untouched
        ref = WAV_DIR / "music" / f"{mod.ID}.wav"
        if ref.exists():
            _, w = wavfile.read(str(ref))
            w = np.asarray(w, dtype=np.float32)
            w = w.T if w.ndim == 2 else w
            same = w.shape == yc.shape
            diff = float(np.abs(w.astype(np.float64) - yc.astype(np.float32)).max()) if same else None
            combat_check = dict(same_shape=bool(same), max_abs_diff=diff, bit_exact=bool(same and diff == 0.0))
        else:
            combat_check = dict(error=f"{ref.name} not rendered")
    rep = music.apply_calm(S, **spec)
    x = S.render(loop=True)
    y, info = music.master_loop(x, MUSIC_LUFS + CALM_OFFSET_DB, -1.5)
    if combat_meta and int(y.shape[-1]) != combat_meta["samples"]:
        raise RuntimeError(f"{mod.ID}: calm has {y.shape[-1]} samples, the combat WAV {combat_meta['samples']}")
    cid = calm_id(name)
    _write_wav(WAV_DIR / "music" / f"{cid}.wav", y)
    meta = dict(id=cid, name=name, loop=True, calm_of=mod.ID, bpm=S.bpm, bars=S.bars, duration=y.shape[-1] / SR, samples=int(y.shape[-1]), **info,
                calm_report=rep, combat_check=combat_check, render_s=time.time() - t)
    (WAV_DIR / "music" / f"{cid}.json").write_text(json.dumps(meta, indent=1))
    return meta


def boss_id(zone: str) -> str:
    return f"mus_{zone}_boss"


def render_boss_one(zone):
    """AG-03: the boss song with the zone's lead voice and motif (songs/boss.py build(zone)) through the same master chain as every loop.
    zone None re-renders the untouched boss song and compares it with the rendered mus_boss.wav (the proof that the layer tags of build() left the
    shared theme bit-identical); nothing is written then."""
    from .songs import boss as bossmod

    t = time.time()
    S = bossmod.build(zone)
    y, info = music.master_loop(S.render(loop=True), MUSIC_LUFS, -1.5)
    base_json = WAV_DIR / "music" / "mus_boss.json"
    base_meta = json.loads(base_json.read_text()) if base_json.exists() else None
    if zone is None:
        ref = WAV_DIR / "music" / "mus_boss.wav"
        if not ref.exists():
            return dict(id="mus_boss", check_base=dict(error="mus_boss.wav not rendered"), render_s=time.time() - t)
        _, w = wavfile.read(str(ref))
        w = np.asarray(w, dtype=np.float32)
        w = w.T if w.ndim == 2 else w
        same = w.shape == y.shape
        diff = float(np.abs(w.astype(np.float64) - y.astype(np.float32)).max()) if same else None
        return dict(id="mus_boss", check_base=dict(same_shape=bool(same), max_abs_diff=diff, bit_exact=bool(same and diff == 0.0)), render_s=time.time() - t)
    if base_meta and int(y.shape[-1]) != base_meta["samples"]:
        raise RuntimeError(f"{boss_id(zone)}: {y.shape[-1]} samples, mus_boss {base_meta['samples']}")
    bid = boss_id(zone)
    _write_wav(WAV_DIR / "music" / f"{bid}.wav", y)
    meta = dict(id=bid, name=zone, loop=True, boss_of="mus_boss", bpm=S.bpm, bars=S.bars, duration=y.shape[-1] / SR, samples=int(y.shape[-1]), **info,
                render_s=time.time() - t)
    (WAV_DIR / "music" / f"{bid}.json").write_text(json.dumps(meta, indent=1))
    return meta


def run_pool(fn, jobs, workers):
    res = []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fn, j): j for j in jobs}
        for f in as_completed(futs):
            try:
                res.append(f.result())
            except Exception as e:  # noqa: BLE001
                print("FAILED", futs[f], repr(e), flush=True)
                raise
    return res


# --------------------------------------------------------------------------- ffmpeg helpers
def ff_encode(x: np.ndarray, q: int, channels: int, kbps: int | None = None) -> bytes:
    """float array (n,) / (2,n) -> mp3 bytes (libmp3lame VBR, 44.1 kHz). Encoded to a *seekable file* so ffmpeg writes the
    Xing/LAME header (encoder delay/padding) that browsers use for gapless trimming (a pipe silently drops it)."""
    data = np.ascontiguousarray((x.T if x.ndim == 2 else x), dtype=np.float32).tobytes()
    with tempfile.TemporaryDirectory(dir=str(WORK)) as td:
        out = Path(td) / "o.mp3"
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(1 if x.ndim == 1 else 2), "-i", "pipe:0",
               "-ac", str(channels), "-ar", str(SR), "-c:a", "libmp3lame", *(["-b:a", f"{kbps}k"] if kbps else ["-q:a", str(q)]), "-write_xing", "1", "-id3v2_version", "0", "-map_metadata", "-1",
               "-f", "mp3", str(out)]
        subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return out.read_bytes()


def ff_decode(mp3: bytes, channels: int) -> np.ndarray:
    """Decode like a browser would (gapless: honours the LAME header) -> float (n,) / (ch,n). Reads from a file, not a pipe."""
    with tempfile.TemporaryDirectory(dir=str(WORK)) as td:
        f = Path(td) / "i.mp3"
        f.write_bytes(mp3)
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(f), "-f", "f32le", "-ac", str(channels), "-ar", str(SR), "pipe:1"]
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    a = np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)
    return a if channels == 1 else a.reshape(-1, channels).T


def ff_loudnorm_measure(wav_path: Path) -> dict:
    """ffmpeg loudnorm pass 1 (measurement only) -> dict(input_i, input_tp, input_lra, input_thresh, target_offset)."""
    cmd = [FFMPEG, "-hide_banner", "-nostats", "-i", str(wav_path), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    txt = p.stderr
    j = txt[txt.rfind("{") : txt.rfind("}") + 1]
    d = json.loads(j)
    return {k: float(v) for k, v in d.items() if k.startswith(("input_", "target_"))}


def short_term_max_lufs(x: np.ndarray, win=0.2) -> float:
    x2 = dsp.to_stereo(x)
    y = dsp._k_weight(x2)
    w = max(1, int(win * SR))
    e = np.sum(y * y, axis=0)
    if e.shape[0] < w:
        e = np.pad(e, (0, w - e.shape[0]))
    cs = np.concatenate([[0.0], np.cumsum(e)])
    ms = (cs[w:] - cs[:-w]) / w
    return float(-0.691 + 10 * np.log10(ms.max() / 2 + 1e-12))


# --------------------------------------------------------------------------- encode
def encode_asset(wav: Path, kind_dir: str, fid: str, channels: int, q: int, peak_limit_db: float, pad_loop: bool, out_root: Path | None = None, kbps: int | None = None):
    sr, data = wavfile.read(str(wav))
    x = data.astype(np.float64)
    x = x.T if x.ndim == 2 else x
    n_in = x.shape[-1]
    scale = 1.0
    mp3 = b""
    dec = None
    for attempt in range(5):
        mp3 = ff_encode(x * scale, q, channels, kbps)
        dec = ff_decode(mp3, channels)
        pk = dsp.true_peak_db(dec)  # 4x-oversampled true peak of the *decoded* mp3 (>= sample peak)
        if pk <= peak_limit_db:
            break
        scale *= dsp.db2lin(peak_limit_db - 0.15 - pk)
    h = hashlib.sha1(mp3).hexdigest()[:8]
    out_dir = (out_root or AUDIO_DIR) / kind_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{fid}.{h}.mp3"
    (out_dir / name).write_bytes(mp3)
    n_dec = dec.shape[-1]
    return dict(id=fid, file=f"assets/audio/{kind_dir}/{name}", bytes=len(mp3), samples_in=int(n_in), samples_dec=int(n_dec), applied_gain_db=float(dsp.lin2db(scale)), peak_db=float(dsp.lin2db(np.abs(dec).max())), channels=channels)


def _encode_job(args):
    return encode_asset(*args)


def clean_audio_dir(ambience: bool = True):
    """Remove the encoded MP3s of the catalogue before a full encode (sfx, music and - once the beds are re-encoded by the same run - ambience)."""
    for sub in ("sfx", "music") + (("ambience",) if ambience else ()):
        d = AUDIO_DIR / sub
        if d.exists():
            for f in d.glob("*.mp3"):
                f.unlink()


def rendered_beds() -> list[str]:
    """Zone ambience beds that have a rendered WAV (`ambience` command) and its json."""
    return sorted(p.stem for p in AMB_WAV_DIR.glob("amb_*.wav") if p.with_suffix(".json").exists())


def add_zone_aliases(manifest: dict) -> dict:
    """Manifest ids the runtime asks for per zone: mus_<zone>_combat = the full zone loop mus_<zone>; mus_<zone>_calm = the same loop until
    a calm stem exists (AG-02: a mus_<zone>_calm entry that is already there is its own file and is left alone); mus_<zone>_boss = the
    shared boss theme until the zone's own boss variant exists (AG-03: likewise left alone)."""
    for z in ZONE_SONGS:
        base = f"mus_{z}"
        if base in manifest:
            for suffix in ("calm", "combat"):
                if suffix == "calm" and f"{base}_calm" in manifest:
                    continue
                manifest[f"{base}_{suffix}"] = dict(manifest[base], id=f"{base}_{suffix}")
            if "mus_boss" in manifest and f"{base}_boss" not in manifest:  # AG-03: a rendered mus_<zone>_boss is its own file and is left alone
                manifest[f"{base}_boss"] = dict(manifest["mus_boss"], id=f"{base}_boss")
    return manifest


def encode_calm_stems(root: Path, workers: int, zones=ZONE_SONGS) -> list[dict]:
    """Encode every rendered mus_<zone>_calm WAV with the seam-checked music loop encoder into <root>/assets/audio/music (root = the stage, or
    apps/game/public for a full `encode`, which then yields the byte-identical MP3 of the staged one). Returns the encode_asset-style results."""
    jobs = [(WAV_DIR / "music" / f"{calm_id(z)}.wav", calm_id(z), MP3_Q_MUSIC, None, Path(root)) for z in zones
            if (WAV_DIR / "music" / f"{calm_id(z)}.wav").exists() and (WAV_DIR / "music" / f"{calm_id(z)}.json").exists()]
    return run_pool(encode_music_loop_staged, jobs, max(1, min(workers, len(jobs)))) if jobs else []


def encode_boss_stems(root: Path, workers: int, zones=ZONE_SONGS) -> list[dict]:
    """AG-03: encode every rendered mus_<zone>_boss WAV with the seam-checked music loop encoder (same as the calm stems) into
    <root>/assets/audio/music (root = the stage, or apps/game/public for a full `encode`: the byte-identical MP3 of the staged one)."""
    jobs = [(WAV_DIR / "music" / f"{boss_id(z)}.wav", boss_id(z), MP3_Q_MUSIC, None, Path(root)) for z in zones
            if (WAV_DIR / "music" / f"{boss_id(z)}.wav").exists() and (WAV_DIR / "music" / f"{boss_id(z)}.json").exists()]
    return run_pool(encode_music_loop_staged, jobs, max(1, min(workers, len(jobs)))) if jobs else []


def encode_catalogue(root: Path, workers: int, only=None):
    """The one place that decides HOW each asset of the catalogue is encoded (see the module docstring), into <root>/assets/audio/<kind>
    (root = apps/game/public for a full `encode`; verify.py runs it into a temp root). `only` restricts it to a set of ids. Nothing is cleaned
    and no manifest is written here. Returns (results as encode_asset-style dicts, sfx defs by file id, music json meta by id, bed ids)."""
    reg = load_sfx()
    root = Path(root)
    out = root / "assets" / "audio"

    def pick(i):
        return only is None or i in only

    jobs, recut_jobs, loop_jobs = [], [], []
    sfx_meta = {}
    for fid, gid, idx in sfx_files():
        if not pick(fid):
            continue
        d = reg[gid]
        ch = 2 if d.stereo else 1
        wav = WAV_DIR / "sfx" / f"{fid}.wav"
        if fid in RECUT_LOOP_SFX:
            recut_jobs.append((wav, fid, SFX_LOOP_KBPS, root, "sfx"))
        else:
            jobs.append((wav, "sfx", fid, ch, MP3_Q_SFX, -1.0, d.loop, out))
        sfx_meta[fid] = d
    music_meta = {}
    for name in SONGS:
        try:
            mod = importlib.import_module(f"audiogen.songs.{name}")
        except ImportError:
            print(f"WARNING: song module {name} missing; skipped")
            continue
        if not pick(mod.ID):
            continue
        wav = WAV_DIR / "music" / f"{mod.ID}.wav"
        if not wav.exists():
            print(f"WARNING: no rendered WAV for {mod.ID}; skipped")
            continue
        if getattr(mod, "LOOP", True):  # AG-03: a looping song gets the seam-checked encoder (0 ms fade when the plain encode is already clean)
            loop_jobs.append((wav, mod.ID, MP3_Q_MUSIC, None, root))
        else:
            jobs.append((wav, "music", mod.ID, 2, MP3_Q_MUSIC, -1.0, False, out))
        music_meta[mod.ID] = json.loads((WAV_DIR / "music" / f"{mod.ID}.json").read_text())
    calm_zones, boss_zones = [], []
    for z in ZONE_SONGS:  # AG-02: a rendered calm stem is its own file (see `calm`), encoded below with the seam-checked loop encoder
        cid = calm_id(z)
        if pick(cid) and (WAV_DIR / "music" / f"{cid}.wav").exists() and (WAV_DIR / "music" / f"{cid}.json").exists():
            music_meta[cid] = json.loads((WAV_DIR / "music" / f"{cid}.json").read_text())
            calm_zones.append(z)
    for z in ZONE_SONGS:  # AG-03: a rendered zone boss theme is its own file, encoded below with the seam-checked loop encoder
        bid = boss_id(z)
        if pick(bid) and (WAV_DIR / "music" / f"{bid}.wav").exists() and (WAV_DIR / "music" / f"{bid}.json").exists():
            music_meta[bid] = json.loads((WAV_DIR / "music" / f"{bid}.json").read_text())
            boss_zones.append(z)
    beds = [b for b in rendered_beds() if pick(b)]  # AG-01: the zone ambience beds (kind ambience, 56 kbps mono CBR, re-cut at the quietest wrap point)
    bed_jobs = [(AMB_WAV_DIR / f"{b}.wav", b, AMBIENCE_KBPS, root, "ambience") for b in beds]

    def pool(fn, js):
        return run_pool(fn, js, max(1, min(workers, len(js)))) if js else []

    res = run_pool(_encode_job, jobs, workers) if jobs else []
    res += pool(encode_music_loop_staged, loop_jobs) + pool(encode_loop_staged, recut_jobs) + pool(encode_loop_staged, bed_jobs)
    res += encode_calm_stems(root, workers, calm_zones) + encode_boss_stems(root, workers, boss_zones)
    return res, sfx_meta, music_meta, beds


def _write_text_atomic(path: Path, text: str):
    """Write text to a sibling temp file and atomically replace `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp"
    try:
        tmp.write_text(text)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def publish_encoded_catalogue(stage_root: Path, res: list[dict], remove_ambience: bool = True):
    """Install verified staged MP3s into `AUDIO_DIR` atomically BEFORE removing obsolete files."""
    # 1. Confirm every expected staged file exists and is non-empty before touching published directories.
    staged_pairs: list[tuple[Path, Path]] = []
    kept: dict[str, set[str]] = {"sfx": set(), "music": set(), "ambience": set()}
    for r in res:
        rel = Path(r["file"])
        src = stage_root / rel
        if not src.exists() or src.stat().st_size == 0:
            raise RuntimeError(f"staged audio output missing or empty: {src}")
        dst = PUB / rel
        staged_pairs.append((src, dst))
        parts = rel.parts
        if len(parts) >= 4 and parts[0] == "assets" and parts[1] == "audio" and parts[2] in kept:
            kept[parts[2]].add(dst.name)

    # 2. Copy replacements into destination dirs via temp-file + os.replace so live files are never absent.
    for src, dst in staged_pairs:
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.parent / f".{dst.name}.{os.getpid()}.{time.time_ns()}.tmp"
        try:
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    # 3. Only after every replacement is safely in place, remove stale MP3s from the refreshed subdirs.
    subdirs = ("sfx", "music") + (("ambience",) if remove_ambience else ())
    for sub in subdirs:
        d = AUDIO_DIR / sub
        if d.exists():
            for f in d.glob("*.mp3"):
                if f.name not in kept[sub]:
                    f.unlink()


def do_encode(workers: int):
    from . import sfx_lib

    reg = load_sfx()
    old_manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    have_beds = bool(rendered_beds())
    if not have_beds and any(k.startswith("amb_") for k in old_manifest):
        print("WARNING: no rendered ambience beds (python -m audiogen.build ambience); the shipped amb_* entries and files are kept as they are")

    WORK.mkdir(parents=True, exist_ok=True)
    tmp_root = Path(tempfile.mkdtemp(prefix="encode_stage_", dir=str(WORK)))
    try:
        res, sfx_meta, music_meta, beds = encode_catalogue(tmp_root, workers)
        if not res:
            raise SystemExit("encode produced zero audio files; existing published files left untouched")
        res.sort(key=lambda r: r["id"])
        by_id = {r["id"]: r for r in res}
        for z in ZONE_SONGS:  # a zone boss theme is a drop-in for mus_boss: same sample count
            bid = boss_id(z)
            if bid in by_id and "mus_boss" in by_id and by_id[bid]["samples_dec"] != by_id["mus_boss"]["samples_dec"]:
                raise SystemExit(f"{bid}: {by_id[bid]['samples_dec']} samples != mus_boss: {by_id['mus_boss']['samples_dec']}")
        for z in ZONE_SONGS:  # the cross-fade needs sample-exact equal lengths
            cid, bid = calm_id(z), f"mus_{z}"
            if cid in by_id and bid in by_id and by_id[cid]["samples_dec"] != by_id[bid]["samples_dec"]:
                raise SystemExit(f"{cid}: {by_id[cid]['samples_dec']} samples != {bid}: {by_id[bid]['samples_dec']} (calm / combat must be sample-exact equal)")

        # ---- measure loudness (decoded mp3 from staging root) for gain computation
        def decoded(rid):
            r = by_id[rid]
            mp3 = (tmp_root / r["file"]).read_bytes()
            return ff_decode(mp3, r["channels"])

        lmax = {}
        for fid, d in sfx_meta.items():
            lmax[fid] = short_term_max_lufs(decoded(fid))
        # reference loudness = 85th percentile of short-term loudness among "important" sounds (level_db >= -3); each sound's
        # playback gain brings it to REF + level_db (never above 1.0, so the peak-normalised file stays the ceiling).
        imp = np.array([lmax[f] for f in lmax if sfx_meta[f].level_db >= -3.0 and not sfx_meta[f].loop])
        ref = float(np.percentile(imp, 85)) if imp.size else -14.0
        manifest = {}
        qa = {}
        for fid, d in sfx_meta.items():
            r = by_id[fid]
            dur = r["samples_dec"] / SR
            gain = float(np.clip(10 ** ((ref + d.level_db - lmax[fid]) / 20.0), 0.05, 1.0))
            e = dict(id=fid, url=r["file"], kind=d.kind, duration=round(dur, 6), gain=round(gain, 3), bytes=r["bytes"])
            if d.loop:
                e["loop"] = True
                e["loopStart"] = 0
                e["loopEnd"] = round(dur, 6)
            manifest[fid] = e
            qa[fid] = dict(r, group=d.group, kind=e["kind"], loop=d.loop, lmax=lmax[fid], gain=gain, level_db=d.level_db, dur=dur, samples_expected=r["samples_in"])
        # variant groups
        for gid, d in reg.items():
            if d.variants > 1 and any(f in manifest for f in sfx_lib.file_ids(d)):
                fids = [f for f in sfx_lib.file_ids(d) if f in manifest]
                first = manifest[fids[0]]
                manifest[gid] = dict(id=gid, url=first["url"], kind=first["kind"], duration=first["duration"], gain=round(float(np.mean([manifest[f]["gain"] for f in fids])), 3),
                                     variants=[manifest[f]["url"] for f in fids], bytes=first["bytes"])
        for mid, meta in music_meta.items():
            r = by_id[mid]
            dec = decoded(mid)
            dur = r["samples_dec"] / SR
            l = dsp.lufs_integrated(dec)
            mod_loop = meta["loop"]
            e = dict(id=mid, url=r["file"], kind="music" if mod_loop else "stinger", duration=round(dur, 6), gain=1.0, bytes=r["bytes"])
            if mod_loop:
                e["loop"] = True
                e["loopStart"] = 0
                e["loopEnd"] = round(dur, 6)
            manifest[mid] = e
            qa[mid] = dict(r, group="music", kind=e["kind"], loop=mod_loop, lufs=l, lufs_master=meta["lufs"], dur=dur, samples_expected=r["samples_in"], bpm=meta["bpm"], bars=meta["bars"])
            try:
                qa[mid]["loudnorm"] = ff_loudnorm_measure(WAV_DIR / "music" / f"{mid}.wav")
            except Exception as ex:  # noqa: BLE001
                qa[mid]["loudnorm_error"] = repr(ex)
        for bid in beds:  # AG-01: the zone ambience beds (same entry shape as the staged ones)
            r = by_id[bid]
            dur = r["samples_dec"] / SR
            manifest[bid] = dict(id=bid, url=r["file"], kind="ambience", duration=round(dur, 6), gain=1.0, bytes=r["bytes"], loop=True, loopStart=0, loopEnd=round(dur, 6))
            qa[bid] = dict(r, group="ambience", kind="ambience", loop=True, samples_expected=r["samples_in"])
        if not have_beds:  # no WAVs to re-encode: keep what is shipped (their files were not cleaned) instead of silently dropping the beds
            manifest.update({k: v for k, v in old_manifest.items() if k.startswith("amb_")})
        add_zone_aliases(manifest)
        # sim-side spellings of the Metin cues (the content/sim use warn/break, the catalogue uses warning/shatter)
        for alias, target in SFX_ALIASES.items():
            if target in manifest:
                manifest[alias] = dict(manifest[target], id=alias)

        manifest_text = json.dumps(dict(sorted(manifest.items())), indent=1)
        qa_text = json.dumps(qa, indent=1)
        # Every replacement is verified: now publish atomically before pruning stale MP3s.
        publish_encoded_catalogue(tmp_root, res, remove_ambience=have_beds)
        _write_text_atomic(MANIFEST, manifest_text)
        _write_text_atomic(QA_JSON, qa_text)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    tot_sfx = sum(r["bytes"] for r in res if r["file"].startswith("assets/audio/sfx"))
    tot_mus = sum(r["bytes"] for r in res if r["file"].startswith("assets/audio/music"))
    tot_amb = sum(r["bytes"] for r in res if r["file"].startswith("assets/audio/ambience"))
    print(f"encoded {len(res)} files; sfx {tot_sfx/1e6:.2f} MB, music {tot_mus/1e6:.2f} MB, ambience {tot_amb/1e6:.2f} MB; ref loudness {ref:.1f}")
    bad = [r for r in res if r["samples_dec"] != r["samples_in"]]
    if bad:
        print("LENGTH MISMATCH (decoded vs source):", [(r["id"], r["samples_in"], r["samples_dec"]) for r in bad][:10])


# --------------------------------------------------------------------------- staged encode (never apps/game/public)
AMBIENCE_KBPS = 56  # a 48 s mono bed at 56 kbps CBR = 336 kB (< the 0.35 MB cap; 48 kbps = 288 kB, 64 kbps = 384 kB is over)


def guard_stage(stage: Path) -> Path:
    stage = Path(stage).resolve()
    pub = PUB.resolve()
    if stage == pub or pub in stage.parents:
        raise SystemExit(f"--stage {stage} is inside apps/game/public: staged assets never go there (they ship in the AU-SHIP step)")
    return stage


def merge_json(path: Path, update: dict) -> dict:
    cur = json.loads(path.read_text()) if path.exists() else {}
    cur.update(update)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(sorted(cur.items())), indent=1))
    return cur


def drop_stale(out_dir: Path, fid: str, keep: str):
    """Remove earlier hashed encodes of `fid` (<fid>.<8 hex>.mp3) so the stage never accumulates duplicates."""
    for f in out_dir.glob(f"{fid}.*.mp3"):
        if f.name != keep and len(f.name.split(".")) == 3:
            f.unlink()


def loop_rotation_candidates(x: np.ndarray, k: int = 12, min_gap_s: float = 0.6) -> list[int]:
    """Rotation offsets o (the loop is re-cut to start at x[o]) ordered by how benign the wrap would be: a tiny sample step
    across the seam inside a calm passage (local rms <= median). The bed is exactly periodic, so any rotation is the same loop."""
    n = len(x)
    dif = np.abs(x - np.roll(x, 1))  # step across the wrap when the loop starts at o
    w = int(0.04 * SR)
    sq = np.concatenate([x[-w:], x, x[:w]]) ** 2
    loc = np.sqrt(np.convolve(sq, np.ones(2 * w + 1) / (2 * w + 1), mode="valid"))
    score = np.where(loc <= np.median(loc), dif / (np.percentile(dif, 99) + 1e-12), np.inf)
    out: list[int] = []
    for o in np.argsort(score):
        if not np.isfinite(score[o]):
            break
        if all(min((int(o) - p) % n, (p - int(o)) % n) > min_gap_s * SR for p in out):
            out.append(int(o))
            if len(out) >= k:
                break
    return out or [0]


def stage_zone_stems(stage: Path, entries: dict, enc: dict) -> dict:
    """AG-02: for every staged mus_<zone>_calm publish mus_<zone>_combat as the full mix (an alias of mus_<zone>: the shipped file when it
    is not restaged, so no payload) and prove that the pair can be cross-faded: equal sample count and duration, the calm stem
    CALM_OFFSET_DB (+-CALM_TOL_DB) under the combat mix in integrated LUFS, a clean loop seam of the calm stem (qa.seam_metrics limits) and
    sample-level alignment with the combat mix (music.stem_alignment: lag 0 in 300-1500 / 1500-6000 Hz, |lag| <= 1 in 40-300 Hz), all measured on the decoded MP3s (the whole-file click count of qa.judge is an ambience rule: every shipped song has 7-85 musical
    attacks that trip it, so for music loops the seam metrics are the verdict). Writes <stage>/stems.json
    (merged by zone); exits when a pair fails (the entries are then not merged into the manifest part)."""
    part_path = stage / "manifest" / "audio.part.json"
    part = json.loads(part_path.read_text()) if part_path.exists() else {}
    live = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}  # read only
    report, bad = {}, []

    from . import qa as _qa  # lazy: qa imports this module

    def measure(e):
        p = stage / e["url"]
        p = p if p.exists() else PUB / e["url"]
        dec = ff_decode(p.read_bytes(), 2)
        step, hf = _qa.seam_metrics(dec)
        return int(dec.shape[-1]), float(dsp.lufs_integrated(dec)), float(dsp.true_peak_db(dec)), float(step), float(hf), dec

    for z in ZONE_SONGS:
        cid, bid, kid = calm_id(z), f"mus_{z}", f"mus_{z}_combat"
        if cid not in entries:
            continue
        base = entries.get(bid) or part.get(bid) or live.get(bid)
        if base is None:
            raise SystemExit(f"{cid}: no {bid} entry (stage, stage part or live manifest) to alias {kid} to")
        n_c, l_c, tp_c, st_c, hf_c, dec_c = measure(entries[cid])
        n_b, l_b, tp_b, st_b, hf_b, dec_b = measure(base)
        delta = l_c - l_b
        al = music.stem_alignment(dec_c, dec_b) if n_c == n_b else None  # AG-02: sample-level lag per band, on the decoded MP3s
        r = dict(calm=cid, combat=kid, calm_file=entries[cid]["url"], combat_file=base["url"], combat_is=bid, samples_calm=n_c, samples_combat=n_b,
                 duration_calm=entries[cid]["duration"], duration_combat=base["duration"], lufs_calm=round(l_c, 3), lufs_combat=round(l_b, 3),
                 calm_minus_combat_lufs=round(delta, 3), true_peak_calm=round(tp_c, 2), true_peak_combat=round(tp_b, 2),
                 bytes_calm=entries[cid]["bytes"], ok_length=bool(n_c == n_b and abs(entries[cid]["duration"] - base["duration"]) < 1e-6),
                 ok_level=bool(abs(delta - CALM_OFFSET_DB) <= CALM_TOL_DB), edge_fade_ms=enc.get(cid, {}).get("edge_fade_ms"),
                 seam_step_calm=round(st_c, 3), seam_hf_calm=round(hf_c, 3), seam_step_combat=round(st_b, 3), seam_hf_combat=round(hf_b, 3),
                 ok_seam=bool(st_c < _qa.AMB_LIMITS["seam_step"] and hf_c < _qa.AMB_LIMITS["seam_hf"]),
                 alignment=al, ok_align=bool(al is not None and al["ok"]))
        report[z] = r
        if not (r["ok_length"] and r["ok_level"] and r["ok_seam"] and r["ok_align"]):
            bad.append(z)
        entries[kid] = dict(base, id=kid)
    if report:
        merge_json(stage / "stems.json", report)
        for z, r in report.items():
            print(f"stems {z:11s} {r['samples_calm']}/{r['samples_combat']} samples  calm {r['lufs_calm']:.2f} LUFS, combat {r['lufs_combat']:.2f}  "
                  f"({r['calm_minus_combat_lufs']:+.2f} dB)  length {'OK' if r['ok_length'] else 'FAIL'}  level {'OK' if r['ok_level'] else 'FAIL'}  "
                  f"seam {r['seam_step_calm']:.3f}/{r['seam_hf_calm']:.3f} {'OK' if r['ok_seam'] else 'FAIL'}  edge fade {r['edge_fade_ms']} ms  "
                  f"lag {music.format_alignment(r['alignment'])} {'OK' if r['ok_align'] else 'FAIL'}")
    if bad:
        raise SystemExit(f"calm / combat pair(s) failed: {bad} (see {stage / 'stems.json'})")
    return report


def stage_boss_variants(stage: Path, entries: dict, enc: dict) -> dict:
    """AG-03: every staged mus_<zone>_boss is a drop-in for the shared boss theme: the same sample count and duration as mus_boss (stage, stage part
    or live manifest), integrated loudness at MUSIC_LUFS +- BOSS_TOL_DB, true peak <= -1 dBTP and a clean loop seam (qa.seam_metrics limits), all
    measured on the decoded MP3s, and a different file from mus_boss. Writes <stage>/boss.json (merged by zone); exits when a variant fails."""
    part_path = stage / "manifest" / "audio.part.json"
    part = json.loads(part_path.read_text()) if part_path.exists() else {}
    live = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}  # read only
    report, bad = {}, []

    from . import qa as _qa  # lazy: qa imports this module

    def measure(e):
        p = stage / e["url"]
        p = p if p.exists() else PUB / e["url"]
        dec = ff_decode(p.read_bytes(), 2)
        step, hf = _qa.seam_metrics(dec)
        return int(dec.shape[-1]), float(dsp.lufs_integrated(dec)), float(dsp.true_peak_db(dec)), float(step), float(hf)

    for z in ZONE_SONGS:
        vid = boss_id(z)
        if vid not in entries:
            continue
        base = entries.get("mus_boss") or part.get("mus_boss") or live.get("mus_boss")
        if base is None:
            raise SystemExit(f"{vid}: no mus_boss entry (stage, stage part or live manifest) to compare with")
        n_v, l_v, tp_v, st_v, hf_v = measure(entries[vid])
        n_b, l_b, tp_b, st_b, hf_b = measure(base)
        r = dict(variant=vid, file=entries[vid]["url"], base_file=base["url"], samples=n_v, samples_base=n_b, duration=entries[vid]["duration"], duration_base=base["duration"],
                 lufs=round(l_v, 3), lufs_base=round(l_b, 3), true_peak=round(tp_v, 2), bytes=entries[vid]["bytes"], edge_fade_ms=enc.get(vid, {}).get("edge_fade_ms"),
                 seam_step=round(st_v, 3), seam_hf=round(hf_v, 3), seam_step_base=round(st_b, 3), seam_hf_base=round(hf_b, 3),
                 ok_length=bool(n_v == n_b and abs(entries[vid]["duration"] - base["duration"]) < 1e-6), ok_level=bool(abs(l_v - MUSIC_LUFS) <= BOSS_TOL_DB),
                 ok_peak=bool(tp_v <= -1.0), ok_seam=bool(st_v < _qa.AMB_LIMITS["seam_step"] and hf_v < _qa.AMB_LIMITS["seam_hf"]),
                 ok_distinct=bool(entries[vid]["url"] != base["url"]))
        report[z] = r
        if not all(r[k] for k in ("ok_length", "ok_level", "ok_peak", "ok_seam", "ok_distinct")):
            bad.append(z)
    if report:
        merge_json(stage / "boss.json", report)
        for z, r in report.items():
            print(f"boss  {z:11s} {r['samples']}/{r['samples_base']} samples  {r['lufs']:.2f} LUFS (mus_boss {r['lufs_base']:.2f})  TP {r['true_peak']:.2f}  "
                  f"length {'OK' if r['ok_length'] else 'FAIL'}  level {'OK' if r['ok_level'] else 'FAIL'}  peak {'OK' if r['ok_peak'] else 'FAIL'}  "
                  f"seam {r['seam_step']:.3f}/{r['seam_hf']:.3f} {'OK' if r['ok_seam'] else 'FAIL'}  edge fade {r['edge_fade_ms']} ms  {r['bytes'] / 1024:.0f} kB")
    if bad:
        raise SystemExit(f"boss variant(s) failed: {bad} (see {stage / 'boss.json'})")
    return report


def encode_loop_staged(args):
    """One seamless loop -> hashed CBR mono MP3 in the stage: tries re-cuts of the loop, keeps the one whose *decoded* MP3 has the
    best seam (step ratio, HF ratio, no clicks). Returns the encode metadata (the manifest entry is built by the caller)."""
    wav, fid, kbps, stage, kind_dir = args
    from . import qa as _qa  # lazy: qa imports this module

    sr, data = wavfile.read(str(wav))
    x = data.astype(np.float64)
    n = len(x)
    best, tried = None, []
    for o in loop_rotation_candidates(x):
        mp3 = ff_encode(np.roll(x, -o), MP3_Q_SFX, 1, kbps)
        dec = ff_decode(mp3, 1)
        if len(dec) != n:  # gapless trim failed: the loop would drift
            tried.append(dict(offset=o, error=f"decoded {len(dec)} != {n} samples"))
            continue
        step, hf = _qa.seam_metrics(dec)
        ncl = len(_qa.click_events(dec))
        score = max(step / 0.3, hf / 2.0) + 10 * ncl
        tried.append(dict(offset=o, seam_step=round(step, 3), seam_hf=round(hf, 3), clicks=ncl))
        if best is None or score < best[0]:
            best = (score, o, mp3, dec, step, hf, ncl)
        if score < 0.5:
            break
    if best is None:
        raise RuntimeError(f"{fid}: no candidate re-cut decoded to {n} samples")
    _, o, mp3, dec, step, hf, ncl = best
    out_dir = stage / "assets" / "audio" / kind_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{fid}.{hashlib.sha1(mp3).hexdigest()[:8]}.mp3"
    (out_dir / name).write_bytes(mp3)
    drop_stale(out_dir, fid, name)
    ref = np.roll(x, -o)
    err = ref - dec
    return dict(id=fid, file=f"assets/audio/{kind_dir}/{name}", bytes=len(mp3), samples_in=int(n), samples_dec=int(len(dec)), channels=1, kbps=kbps,
                rotation_samples=int(o), rotation_s=round(o / SR, 3), seam_step_ratio=float(step), seam_hf_ratio=float(hf), clicks=int(ncl),
                lufs=float(dsp.lufs_integrated(dec)), lufs_source=float(dsp.lufs_integrated(x)), peak_db=float(dsp.lin2db(np.abs(dec).max())),
                codec_snr_db=float(10 * np.log10(np.sum(ref**2) / (np.sum(err**2) + 1e-20))), candidates=tried)


SEAM_FADES_MS = (0.0, 1.0, 2.0, 4.0)  # AG-02: edge-fade candidates of a staged music loop, the shortest one with a clean decoded seam wins


def edge_fade(x: np.ndarray, ms: float) -> np.ndarray:
    """Raised-cosine fade-in / fade-out of `ms` at the two ends of a loop ((n,) or (ch, n)); the length does not change."""
    f = int(round(ms / 1000.0 * SR))
    if f < 2:
        return x
    r = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, f))
    y = np.array(x, dtype=np.float64, copy=True)
    y[..., :f] *= r
    y[..., -f:] *= r[::-1]
    return y


def encode_music_loop_staged(args):
    """A staged music loop (zone song, calm stem) -> hashed MP3. Unlike an ambience bed it cannot be re-cut to a quiet spot: it must keep its
    exact start and length (the runtime cross-fades calm and combat in sync). The MP3 start / end effects can still leave a click-like step
    at the wrap of a quiet, low-frequency loop start (seen on the Suryeon calm stem: step 1.5, HF x15), so the shortest of
    SEAM_FADES_MS whose *decoded* MP3 has a clean seam (qa limits) is applied to the two ends before encoding; most loops need none (0 ms)."""
    wav, fid, q, kbps, stage = args
    from . import qa as _qa  # lazy: qa imports this module

    sr, data = wavfile.read(str(wav))
    x = data.astype(np.float64).T
    n = x.shape[-1]
    lim_step, lim_hf = _qa.AMB_LIMITS["seam_step"], _qa.AMB_LIMITS["seam_hf"]
    best, tried = None, []
    for ms in SEAM_FADES_MS:
        y = edge_fade(x, ms)
        scale, mp3, dec = 1.0, b"", None
        for _ in range(5):  # decoded true peak <= -1 dBFS, like encode_asset
            mp3 = ff_encode(y * scale, q, 2, kbps)
            dec = ff_decode(mp3, 2)
            pk = dsp.true_peak_db(dec)
            if pk <= -1.0:
                break
            scale *= dsp.db2lin(-1.0 - 0.15 - pk)
        step, hf = _qa.seam_metrics(dec)
        gapless = dec.shape[-1] == n
        tried.append(dict(edge_fade_ms=ms, seam_step=round(float(step), 3), seam_hf=round(float(hf), 3), gapless=bool(gapless)))
        score = max(step / lim_step, hf / lim_hf) + (0 if gapless else 10)
        if best is None or score < best[0]:
            best = (score, ms, mp3, dec, step, hf, scale)
        if gapless and step < lim_step and hf < lim_hf:
            break
    _, ms, mp3, dec, step, hf, scale = best
    out_dir = stage / "assets" / "audio" / "music"
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{fid}.{hashlib.sha1(mp3).hexdigest()[:8]}.mp3"
    (out_dir / name).write_bytes(mp3)
    drop_stale(out_dir, fid, name)
    return dict(id=fid, file=f"assets/audio/music/{name}", bytes=len(mp3), samples_in=int(n), samples_dec=int(dec.shape[-1]), applied_gain_db=float(dsp.lin2db(scale)),
                peak_db=float(dsp.lin2db(np.abs(dec).max())), channels=2, edge_fade_ms=ms, seam_step_ratio=float(step), seam_hf_ratio=float(hf), seam_candidates=tried)


def _plain_job(args):
    wav, kind_dir, fid, channels, q, loop, stage, kbps = args
    return encode_asset(wav, kind_dir, fid, channels, q, -1.0, loop, stage / "assets" / "audio", kbps)


def stage_encode_ids(stage: Path, ids: list[str], workers: int, kbps: int | None):
    """Encode already rendered WAVs (ambience beds, SFX files, songs) into the stage; writes manifest/audio.part.json + encode.json
    (merged by id). sfx entries get their playback gain from the live reference loudness (qa.json), like encode does."""
    stage = guard_stage(stage)
    stage.mkdir(parents=True, exist_ok=True)
    reg = load_sfx()
    sfx_by_file = {fid: reg[gid] for fid, gid, _ in sfx_files()}
    amb = [i for i in ids if (AMB_WAV_DIR / f"{i}.wav").exists()]
    amb_jobs = [(AMB_WAV_DIR / f"{i}.wav", i, kbps or AMBIENCE_KBPS, stage, "ambience") for i in amb]
    plain_jobs, loop_jobs, sfx_loop_jobs, kinds = [], [], [], {}
    for i in ids:
        if i in amb:
            continue
        if i in sfx_by_file:
            d = sfx_by_file[i]
            if d.loop and d.kind == "ambience" and not d.stereo:  # AG-03: a looping ambience SFX is re-cut at its quietest wrap point like a zone bed
                sfx_loop_jobs.append((WAV_DIR / "sfx" / f"{i}.wav", i, kbps or SFX_LOOP_KBPS, stage, "sfx"))
                kinds[i] = "sfxloop"
                continue
            plain_jobs.append((WAV_DIR / "sfx" / f"{i}.wav", "sfx", i, 2 if d.stereo else 1, MP3_Q_SFX, d.loop, stage, kbps))
            kinds[i] = "sfx"
        elif (WAV_DIR / "music" / f"{i}.json").exists() and (WAV_DIR / "music" / f"{i}.wav").exists():
            if json.loads((WAV_DIR / "music" / f"{i}.json").read_text()).get("loop", True):
                loop_jobs.append((WAV_DIR / "music" / f"{i}.wav", i, MP3_Q_MUSIC, kbps, stage))  # loops: seam-checked encode
            else:
                plain_jobs.append((WAV_DIR / "music" / f"{i}.wav", "music", i, 2, MP3_Q_MUSIC, False, stage, kbps))
            kinds[i] = "music"
        else:
            raise SystemExit(f"{i}: no rendered WAV to stage (render it first)")
    res = run_pool(encode_loop_staged, amb_jobs, max(1, min(workers, len(amb_jobs)))) if amb_jobs else []
    entries, enc = {}, {}
    for r in res:
        dur = r["samples_dec"] / SR
        entries[r["id"]] = dict(id=r["id"], url=r["file"], kind="ambience", duration=round(dur, 6), gain=1.0, bytes=r["bytes"], loop=True, loopStart=0, loopEnd=round(dur, 6))
        enc[r["id"]] = dict(r, group="ambience", kind="ambience", loop=True, samples_expected=r["samples_in"])
    qa_live = json.loads(QA_JSON.read_text()) if QA_JSON.exists() else {}
    imp = [v["lmax"] for v in qa_live.values() if v.get("level_db", -99) >= -3.0 and not v.get("loop") and "lmax" in v and v.get("group") != "music"]
    ref = float(np.percentile(imp, 85)) if imp else 0.0
    for r in run_pool(encode_loop_staged, sfx_loop_jobs, max(1, min(workers, len(sfx_loop_jobs)))) if sfx_loop_jobs else []:
        d = sfx_by_file[r["id"]]  # playback gain from the live reference loudness, like every SFX (never above 1.0)
        dec = ff_decode((stage / r["file"]).read_bytes(), 1)
        dur = r["samples_dec"] / SR
        lmax = short_term_max_lufs(dec)
        gain = float(np.clip(10 ** ((ref + d.level_db - lmax) / 20.0), 0.05, 1.0))
        entries[r["id"]] = dict(id=r["id"], url=r["file"], kind=d.kind, duration=round(dur, 6), gain=round(gain, 3), bytes=r["bytes"], loop=True, loopStart=0, loopEnd=round(dur, 6))
        enc[r["id"]] = dict(r, group=d.group, kind=d.kind, loop=True, lmax=lmax, gain=gain, level_db=d.level_db, samples_expected=r["samples_in"])
    if plain_jobs or loop_jobs:
        pres = run_pool(_plain_job, plain_jobs, max(1, min(workers, len(plain_jobs)))) if plain_jobs else []
        if loop_jobs:
            pres += run_pool(encode_music_loop_staged, loop_jobs, max(1, min(workers, len(loop_jobs))))
        for r in pres:  # one hashed encode per id in the stage
            drop_stale(stage / "assets" / "audio" / Path(r["file"]).parent.name, r["id"], Path(r["file"]).name)
        for r in pres:
            fid, ch = r["id"], r["channels"]
            dec = ff_decode((stage / r["file"]).read_bytes(), ch)
            dur = r["samples_dec"] / SR
            if kinds[fid] == "sfx":
                d = sfx_by_file[fid]
                lmax = short_term_max_lufs(dec)
                gain = float(np.clip(10 ** ((ref + d.level_db - lmax) / 20.0), 0.05, 1.0))
                e = dict(id=fid, url=r["file"], kind=d.kind, duration=round(dur, 6), gain=round(gain, 3), bytes=r["bytes"])
                if d.loop:
                    e.update(loop=True, loopStart=0, loopEnd=round(dur, 6))
                enc[fid] = dict(r, group=d.group, kind=d.kind, loop=d.loop, lmax=lmax, gain=gain, level_db=d.level_db, samples_expected=r["samples_in"])
            else:
                meta = json.loads((WAV_DIR / "music" / f"{fid}.json").read_text())
                e = dict(id=fid, url=r["file"], kind="music" if meta["loop"] else "stinger", duration=round(dur, 6), gain=1.0, bytes=r["bytes"])
                if meta["loop"]:
                    e.update(loop=True, loopStart=0, loopEnd=round(dur, 6))
                enc[fid] = dict(r, group="music", kind=e["kind"], loop=meta["loop"], lufs=dsp.lufs_integrated(dec), samples_expected=r["samples_in"])
            entries[fid] = e
    stage_zone_stems(stage, entries, enc)
    stage_boss_variants(stage, entries, enc)
    merge_json(stage / "manifest" / "audio.part.json", entries)
    merge_json(stage / "encode.json", enc)
    for fid in sorted(entries):
        e = entries[fid]
        extra = ""
        if fid in amb or kinds.get(fid) == "sfxloop":
            r = enc[fid]
            extra = f"  re-cut @{r['rotation_s']}s  seam {r['seam_step_ratio']:.2f}/{r['seam_hf_ratio']:.2f}  LUFS {r['lufs']:.1f}  codec SNR {r['codec_snr_db']:.1f} dB"
        print(f"staged {fid:18s} {e['bytes'] / 1024:6.1f} kB  {e['duration']:.2f}s  gain {e['gain']}{extra}")
    print(f"stage {stage}: {len(entries)} entries merged into manifest/audio.part.json (apps/game/public untouched)")


def do_encode_staged(stage: Path, only: str | None, workers: int, kbps: int | None):
    if not only:
        raise SystemExit("encode --stage stages selected ids: pass --only <substring> (the whole catalogue is encoded by plain `encode`)")
    ids = sorted({p.stem for p in AMB_WAV_DIR.glob("*.wav") if only in p.stem})
    ids += sorted({fid for fid, _, _ in sfx_files() if only in fid})
    ids += sorted({p.stem for p in (WAV_DIR / "music").glob("*.wav") if only in p.stem})
    if not ids:
        raise SystemExit(f"nothing rendered matches --only {only!r}")
    stage_encode_ids(stage, ids, workers, kbps)


def render_bed_one(bid):
    from . import ambience

    t = time.time()
    x, info = ambience.render(bid)
    _write_wav(AMB_WAV_DIR / f"{bid}.wav", x)
    info["render_s"] = round(time.time() - t, 1)
    (AMB_WAV_DIR / f"{bid}.json").write_text(json.dumps(info, indent=1))
    return info


def do_ambience(a):
    from . import ambience

    ids = [b for b in ambience.BEDS if not a.only or a.only in b]
    if not ids:
        raise SystemExit(f"no ambience bed matches --only {a.only!r}; beds: {', '.join(ambience.BEDS)}")
    infos = run_pool(render_bed_one, ids, max(1, min(a.jobs, len(ids), 4)))
    for i in sorted(infos, key=lambda i: i["id"]):
        print(f"  {i['id']:16s} {i['duration']:.2f}s  LUFS {i['lufs']:.2f}  peak {i['peak_db']:.1f} dBFS  render {i['render_s']}s")
    if a.stage:
        stage_encode_ids(Path(a.stage), sorted(ids), a.jobs, a.kbps)


def do_calm(a):
    zones = [z for z in ZONE_SONGS if not a.only or a.only in z]
    if not zones:
        if a.cmd == "all":
            return  # an --only filter that names other assets
        raise SystemExit(f"no zone song matches --only {a.only!r}; zones: {', '.join(ZONE_SONGS)}")
    metas = run_pool(render_calm_one, [(z, a.check_combat) for z in zones], max(1, min(a.jobs, len(zones), 4)))
    for m in sorted(metas, key=lambda m: m["id"]):
        cc = m["combat_check"]
        chk = "" if cc is None else ("  combat check: bit-exact" if cc.get("bit_exact") else f"  combat check: {cc}")
        print(f"  {m['id']:20s} {m['duration']:8.3f}s {m['samples']} smp  LUFS {m['lufs']:.2f}  peak {m['peak_db']:.2f}  kept {len(m['calm_report']['kept'])} tracks, "
              f"muted {len(m['calm_report']['muted'])}  render {m['render_s']:.0f}s{chk}")
    if a.stage:
        stage_encode_ids(Path(a.stage), sorted(m["id"] for m in metas), a.jobs, a.kbps)


def do_boss(a):
    zones = [z for z in ZONE_SONGS if not a.only or a.only in z]
    if not zones:
        if a.cmd == "all":
            return  # an --only filter that names other assets
        raise SystemExit(f"no zone song matches --only {a.only!r}; zones: {', '.join(ZONE_SONGS)}")
    jobs = zones + ([None] if a.check_base else [])
    metas = run_pool(render_boss_one, jobs, max(1, min(a.jobs, len(jobs), 5)))
    for m in sorted(metas, key=lambda m: (m["id"], "check_base" in m)):
        if "check_base" in m:
            cb = m["check_base"]
            print(f"  mus_boss (untouched build) vs rendered WAV: {'bit-exact' if cb.get('bit_exact') else cb}  render {m['render_s']:.0f}s")
        else:
            print(f"  {m['id']:22s} {m['duration']:8.3f}s {m['samples']} smp  LUFS {m['lufs']:.2f}  peak {m['peak_db']:.2f}  render {m['render_s']:.0f}s")
    if a.stage:
        stage_encode_ids(Path(a.stage), sorted(m["id"] for m in metas if "check_base" not in m), a.jobs, a.kbps)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sfx", "music", "encode", "all", "list", "ambience", "calm", "boss"])
    ap.add_argument("--only", default=None)
    ap.add_argument("--jobs", type=int, default=10)
    ap.add_argument("--stage", nargs="?", const=str(STAGE_DIR), default=None, help="encode into this stage dir instead of apps/game/public (default .research/audio/stage)")
    ap.add_argument("--kbps", type=int, default=None, help="CBR bitrate of staged MP3s (ambience beds default to 56)")
    ap.add_argument("--check-combat", action="store_true", help="calm: also re-render the full mix and compare it with the rendered mus_<zone>.wav")
    ap.add_argument("--check-base", action="store_true", help="boss: also re-render the untouched boss song and compare it with the rendered mus_boss.wav")
    a = ap.parse_args(argv)
    t = time.time()
    if a.stage and a.cmd in ("all", "sfx", "music", "list"):
        raise SystemExit("--stage belongs to `ambience`, `calm` and `encode --only <id>`")
    if a.stage:
        guard_stage(Path(a.stage))
    if a.cmd == "list":
        for fid, gid, idx in sfx_files():
            print(fid)
        return
    if a.cmd in ("sfx", "all"):
        jobs = [j for j in sfx_files() if not a.only or a.only in j[0]]
        res = run_pool(render_sfx_one, jobs, a.jobs)
        print(f"rendered {len(res)} sfx in {time.time()-t:.1f}s; longest {max(r[1] for r in res):.2f}s")
    if a.cmd in ("music", "all"):
        names = [n for n in SONGS if (not a.only or a.only in n) and (ROOT / "tools/audiogen/audiogen/songs" / f"{n}.py").exists()]
        res = run_pool(render_song_one, names, min(a.jobs, 6))
        for m in sorted(res, key=lambda m: m["id"]):
            print(f"  {m['id']:18s} {m['duration']:7.2f}s  LUFS {m['lufs']:.2f} peak {m['peak_db']:.2f}  render {m['render_s']:.0f}s")
    if a.cmd in ("calm", "all"):
        do_calm(a)
    if a.cmd in ("boss", "all"):
        do_boss(a)
    if a.cmd == "ambience":
        do_ambience(a)
    if a.cmd == "encode" and a.stage:
        do_encode_staged(Path(a.stage), a.only, a.jobs, a.kbps)
    elif a.cmd in ("encode", "all"):
        do_encode(a.jobs)
    print(f"done in {time.time()-t:.1f}s")


if __name__ == "__main__":
    main()
