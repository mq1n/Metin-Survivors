"""Self-QA: measure decoded MP3s, render spectrograms, write qa.md/qa.csv and the HTML sound board.

    python -m audiogen.qa            # metrics + spectrograms + board
    python -m audiogen.qa --stage [DIR]   # staged assets only (build.py --stage): measure the decoded MP3s, judge them against the
                                          # limits below, write <stage>/qa.json, qa.md and spectrograms/ (exit 1 on any FAIL)
"""
from __future__ import annotations

import csv
import html
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from scipy import signal as sps

from . import dsp, viz
from .build import PUB, QA_JSON, WORK, MANIFEST, ff_decode
from .dsp import SR

SPEC_DIR = WORK / "spectrograms"
BOARD = WORK / "board.html"

# limits of a staged asset (AG-01 acceptance). A zone ambience bed (kind ambience, id amb_*) gets all of them. A looping asset of kind ambience
# (the beds, sfx_lava_bubble_loop) must have no click event anywhere in the file; a MUSIC loop has musical attacks all over (every shipped song
# trips a whole-file count: 1-85 events), so for a song the verdict is the seam: no click event within SEAM_CLICK_MS of the wrap, measured on the
# wrapped excerpt (last 1 s + first 1 s of the decoded MP3). The whole-file count of a song is reported as information only.
AMB_LIMITS = dict(max_bytes=350_000, seam_step=0.3, seam_hf=2.0, lufs_lo=-30.0, lufs_hi=-26.0, dur_lo=47.5, dur_hi=48.5)
GENERIC_LIMITS = dict(true_peak=-1.0, dc=0.005)
SEAM_CLICK_MS = 5.0  # a click event closer than this to the loop wrap fails a music loop
SEAM_WIN_S = 1.0  # the wrapped excerpt: this much before + this much after the wrap
MID_HP_HZ = 1500.0  # second click detector (ambience beds): the ember crackle of amb_daeryeol lives at 700-4200 Hz, below the 6 kHz one


def click_events(x: np.ndarray, skip_ms: float = 12.0, hp_hz: float = 6000.0):
    """Isolated broadband spikes (possible clicks): energy above hp_hz (default 6 kHz) per 0.7 ms frame vs the median of nearby frames."""
    m = x if x.ndim == 1 else x.mean(0)
    if m.shape[0] < 2048:
        return []
    h = sps.sosfilt(sps.butter(4, hp_hz / (SR / 2), "high", output="sos"), m)
    fr = 32
    nf = h.shape[0] // fr
    e = (h[: nf * fr].reshape(nf, fr) ** 2).mean(1) + 1e-14
    out = []
    k = 24  # neighbourhood in frames (~17 ms)
    for i in range(int(skip_ms / 1000 * SR / fr) + 2, nf - 2):
        lo, hi = max(0, i - k), min(nf, i + k)
        nb = np.concatenate([e[lo : max(lo, i - 2)], e[min(hi, i + 3) : hi]])
        if nb.size < 6:
            continue
        ratio = e[i] / (np.median(nb) + 1e-14)
        pk_db = 10 * np.log10(e[i])
        if ratio > 200 and pk_db > -62:
            out.append((i * fr / SR, float(10 * np.log10(ratio)), float(pk_db)))
    # merge neighbouring frames
    merged = []
    for t, r, p in out:
        if merged and t - merged[-1][0] < 0.004:
            if r > merged[-1][1]:
                merged[-1] = (merged[-1][0], r, p)
        else:
            merged.append((t, r, p))
    return merged


def seam_clicks(x: np.ndarray, hp_hz: float = 6000.0, half_ms: float = SEAM_CLICK_MS, win_s: float = SEAM_WIN_S):
    """Click events at the loop wrap only: qa.click_events on the wrapped excerpt (last win_s + first win_s of the decoded loop, the wrap is at
    win_s) and the events whose 0.7 ms frame touches +-half_ms around it. Returns [(offset_ms from the wrap, ratio_db, level_db)], the offset
    negative before the wrap, positive after it."""
    w = int(win_s * SR)
    ext = np.concatenate([x[..., -w:], x[..., :w]], axis=-1)
    fr_s = 32 / SR
    out = []
    for t, r, p in click_events(ext, hp_hz=hp_hz):
        if win_s - half_ms / 1000.0 - fr_s <= t <= win_s + half_ms / 1000.0:
            out.append((round((t - win_s) * 1000.0, 2), r, p))
    return out


def seam_metrics(x: np.ndarray):
    """Loop-seam continuity: the sample step across the wrap relative to typical steps near the seam."""
    m = x if x.ndim == 1 else x
    chans = [m] if m.ndim == 1 else [m[0], m[1]]
    worst = 0.0
    hf = 0.0
    for c in chans:
        w = 2048
        ext = np.concatenate([c[-w:], c[:w]])
        d = np.abs(np.diff(ext))
        step = d[w - 1]
        loc = np.percentile(np.concatenate([d[: w - 8], d[w + 8 :]]), 99)
        worst = max(worst, float(step / (loc + 1e-9)))
        h = sps.sosfilt(sps.butter(4, 6000 / (SR / 2), "high", output="sos"), ext)
        hseam = float(np.sqrt(np.mean(h[w - 32 : w + 32] ** 2)))
        hbase = float(np.sqrt(np.mean(np.concatenate([h[: w - 200], h[w + 200 :]]) ** 2)) + 1e-12)
        hf = max(hf, hseam / hbase)
    return worst, hf


def analyse(args):
    fid, entry, qa = args[:3]
    root = args[3] if len(args) > 3 else PUB
    spec_dir = args[4] if len(args) > 4 else SPEC_DIR
    mp3 = (root / entry["url"]).read_bytes()
    ch = qa["channels"]
    x = ff_decode(mp3, ch)
    xm = x if x.ndim == 1 else x.mean(0)
    n = x.shape[-1]
    peak = float(np.abs(x).max())
    tp = dsp.true_peak_db(x)
    rms_db = float(dsp.lin2db(dsp.rms(x)))
    dc = float(np.mean(xm))
    clip = int(np.sum(np.abs(x) >= 0.999))
    env = np.abs(xm)
    thr = peak * 10 ** (-40 / 20)
    idx = np.nonzero(env > thr)[0]
    onset_ms = float(idx[0] / SR * 1000) if idx.size else -1
    tail = float(dsp.lin2db(np.abs(xm[-8:]).max() / (peak + 1e-12)))
    head = float(dsp.lin2db(np.abs(xm[:4]).max() / (peak + 1e-12)))
    f, P = sps.welch(xm, SR, nperseg=min(4096, max(256, n // 2)))
    cum = np.cumsum(P) / (P.sum() + 1e-30)
    roll95 = float(f[np.searchsorted(cum, 0.95)])
    cent = float((f * P).sum() / (P.sum() + 1e-30))
    clicks = click_events(x)
    res = dict(id=fid, dur=n / SR, bytes=len(mp3), peak_db=float(dsp.lin2db(peak)), true_peak_db=tp, rms_db=rms_db, dc=dc, clip=clip, onset_ms=onset_ms,
               head_db=head, tail_db=tail, rolloff95=roll95, centroid=cent, clicks=clicks[:6], n_clicks=len(clicks))
    if x.ndim == 2:
        # mono compatibility: loudness of the L+R sum vs the stereo mix (negative = phase cancellation)
        res["mono_delta_db"] = float(dsp.lufs_integrated(xm) - dsp.lufs_integrated(x))
    if qa.get("kind") in ("music", "ambience") or qa.get("loop"):
        res["lufs"] = dsp.lufs_integrated(x)
    if qa.get("loop"):
        sw, hf_ratio = seam_metrics(x)
        res["seam_step_ratio"] = sw
        res["seam_hf_ratio"] = hf_ratio
        sc = seam_clicks(x)
        res["n_seam_clicks"] = len(sc)
        res["seam_clicks"] = sc[:4]
        if qa.get("kind") == "ambience":  # second detector for the beds: the layers the 6 kHz one cannot see (ember crackle 700-4200 Hz)
            sm = seam_clicks(x, hp_hz=MID_HP_HZ)
            res["n_seam_clicks_mid"] = len(sm)
            res["seam_clicks_mid"] = sm[:4]
            res["n_clicks_mid"] = len(click_events(x, hp_hz=MID_HP_HZ))
    elif qa.get("group") != "music":
        res["lufs"] = dsp.lufs_integrated(x)
    # spectrogram
    spec_dir.mkdir(parents=True, exist_ok=True)
    is_music = qa.get("group") in ("music", "ambience")
    viz.spectrogram_png(x, spec_dir / f"{fid}.png", f"{fid}  {n/SR:.2f}s  peak {res['peak_db']:.1f} dBFS", nfft=2048 if is_music else 1024,
                        size=(11, 4.2) if is_music else (7.5, 3.4), dpi=80)
    return res


def judge(r, entry, enc):
    """Staged-asset verdict: list of (check, ok, value, limit)."""
    checks = []

    def chk(name, ok, value, limit):
        checks.append(dict(check=name, ok=bool(ok), value=value, limit=limit))

    chk("true_peak_dBTP", r["true_peak_db"] <= GENERIC_LIMITS["true_peak"], round(r["true_peak_db"], 2), f"<= {GENERIC_LIMITS['true_peak']}")
    chk("clip_samples", r["clip"] == 0, r["clip"], "== 0")
    chk("dc", abs(r["dc"]) <= GENERIC_LIMITS["dc"], round(r["dc"], 6), f"|dc| <= {GENERIC_LIMITS['dc']}")
    chk("gapless_length", enc.get("samples_dec") == enc.get("samples_in"), f"{enc.get('samples_dec')}/{enc.get('samples_in')}", "decoded == source samples")
    if entry.get("loop"):
        chk("seam_step_ratio", r["seam_step_ratio"] < AMB_LIMITS["seam_step"], round(r["seam_step_ratio"], 3), f"< {AMB_LIMITS['seam_step']}")
        chk("seam_hf_ratio", r["seam_hf_ratio"] < AMB_LIMITS["seam_hf"], round(r["seam_hf_ratio"], 3), f"< {AMB_LIMITS['seam_hf']}")
        if entry.get("kind") == "ambience":  # a bed / an ambience loop has no musical attacks: no click event anywhere
            chk("clicks", r["n_clicks"] == 0, r["n_clicks"], "== 0 (whole file, > 6 kHz)")
            chk("clicks_mid", r.get("n_clicks_mid", 0) == 0, r.get("n_clicks_mid", 0), f"== 0 (whole file, > {MID_HP_HZ:g} Hz: the ember crackle layer)")
            chk("seam_clicks_mid", r.get("n_seam_clicks_mid", 0) == 0, r.get("n_seam_clicks_mid", 0), f"== 0 within +-{SEAM_CLICK_MS:g} ms of the wrap (> {MID_HP_HZ:g} Hz)")
        else:  # a music loop: musical onsets are not clicks; only the wrap is judged (the whole-file count stays in measured.n_clicks as information)
            chk("seam_clicks", r["n_seam_clicks"] == 0, r["n_seam_clicks"], f"== 0 within +-{SEAM_CLICK_MS:g} ms of the wrap")
    if entry.get("kind") == "ambience" and entry["id"].startswith("amb_"):
        chk("bytes", entry["bytes"] <= AMB_LIMITS["max_bytes"], entry["bytes"], f"<= {AMB_LIMITS['max_bytes']} (0.35 MB)")
        chk("lufs_integrated", AMB_LIMITS["lufs_lo"] <= r["lufs"] <= AMB_LIMITS["lufs_hi"], round(r["lufs"], 2), f"{AMB_LIMITS['lufs_lo']}..{AMB_LIMITS['lufs_hi']}")
        chk("duration_s", AMB_LIMITS["dur_lo"] <= r["dur"] <= AMB_LIMITS["dur_hi"], round(r["dur"], 3), f"{AMB_LIMITS['dur_lo']}..{AMB_LIMITS['dur_hi']}")
        chk("loop_flags", entry.get("loop") is True and entry.get("loopStart") == 0 and abs(entry.get("loopEnd", 0) - r["dur"]) < 1e-3, f"loop={entry.get('loop')} end={entry.get('loopEnd')}", "loop, 0..duration")
    return checks


def main_stage(stage):
    from .build import guard_stage

    stage = guard_stage(stage)
    part = json.loads((stage / "manifest" / "audio.part.json").read_text())
    enc = json.loads((stage / "encode.json").read_text())
    jobs = [(fid, part[fid], enc[fid], stage, stage / "spectrograms") for fid in sorted(part) if fid in enc]
    out = {}
    with ProcessPoolExecutor(max_workers=min(10, max(1, len(jobs)))) as ex:
        for r in ex.map(analyse, jobs):
            out[r["id"]] = r
    rep = {}
    for fid, r in out.items():
        checks = judge(r, part[fid], enc[fid])
        rep[fid] = dict(measured={k: v for k, v in r.items() if k != "clicks"}, clicks=r["clicks"], clicks_whole_file_info=r["n_clicks"], kbps=enc[fid].get("kbps"), rotation_s=enc[fid].get("rotation_s"),
                        codec_snr_db=enc[fid].get("codec_snr_db"), checks=checks, verdict="PASS" if all(c["ok"] for c in checks) else "FAIL",
                        spectrogram=f"spectrograms/{fid}.png")
    summary = dict(stage=str(stage), assets=len(rep), pass_=sorted(k for k, v in rep.items() if v["verdict"] == "PASS"), fail=sorted(k for k, v in rep.items() if v["verdict"] == "FAIL"))
    (stage / "qa.json").write_text(json.dumps(dict(summary=summary, assets=rep), indent=1))
    L = ["# Staged audio QA (decoded MP3 measurements)\n", "Clicks: an ambience loop (the beds, sfx_lava_bubble_loop) must have none anywhere (> 6 kHz; beds also > 1.5 kHz, whole file and at the wrap); a music loop is judged on its wrap only (no click event within +-5 ms of it, on the wrapped excerpt). The whole-file count of a song is musical attacks, shown as information.\n", "| id | verdict | KB | dur s | LUFS | true peak | seam step | seam HF | clicks (whole file; info for music) | seam clicks (+-5 ms) | clicks > 1.5 kHz (beds: whole / wrap) | re-cut at | codec SNR | failed checks |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for fid, v in rep.items():
        m = v["measured"]
        bad = ", ".join(c["check"] for c in v["checks"] if not c["ok"])
        L.append(f"| {fid} | {v['verdict']} | {m['bytes'] / 1024:.0f} | {m['dur']:.2f} | {m.get('lufs', float('nan')):.2f} | {m['true_peak_db']:.1f} | {m.get('seam_step_ratio', float('nan')):.3f} | {m.get('seam_hf_ratio', float('nan')):.3f} | {m['n_clicks']} | {m.get('n_seam_clicks', '-')} | {m.get('n_clicks_mid', '-')} / {m.get('n_seam_clicks_mid', '-')} | {v['rotation_s']} | {v['codec_snr_db'] if v['codec_snr_db'] is None else round(v['codec_snr_db'], 1)} | {bad} |")
    (stage / "qa.md").write_text("\n".join(L), encoding="utf-8")
    for fid, v in rep.items():
        m = v["measured"]
        print(f"{v['verdict']}  {fid:18s} {m['bytes'] / 1024:6.1f} kB  LUFS {m.get('lufs', float('nan')):6.2f}  seam step {m.get('seam_step_ratio', float('nan')):.3f}  HF {m.get('seam_hf_ratio', float('nan')):.3f}  clicks {m['n_clicks']} (seam {m.get('n_seam_clicks', '-')})  TP {m['true_peak_db']:.1f}")
    print(f"staged QA: {len(summary['pass_'])} pass, {len(summary['fail'])} fail -> {stage / 'qa.json'}")
    return 1 if summary["fail"] else 0


def main(argv=None):
    import argparse

    from .build import STAGE_DIR

    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", nargs="?", const=str(STAGE_DIR), default=None, help="QA of the staged assets (default dir .research/audio/stage) instead of the shipped catalogue")
    a = ap.parse_args(argv)
    if a.stage:
        sys.exit(main_stage(Path(a.stage)))
    manifest = json.loads(MANIFEST.read_text())
    qa = json.loads(QA_JSON.read_text())
    jobs = [(fid, manifest[fid], qa[fid]) for fid in qa if fid in manifest]
    out = {}
    with ProcessPoolExecutor(max_workers=10) as ex:
        for r in ex.map(analyse, jobs, chunksize=4):
            out[r["id"]] = r
    for fid, r in out.items():
        r.update({k: v for k, v in qa[fid].items() if k in ("group", "kind", "loop", "gain", "lufs_master", "bpm", "bars", "samples_in", "samples_dec", "loudnorm", "level_db")})
    (WORK / "qa_measured.json").write_text(json.dumps(out, indent=1))
    write_tables(out, manifest)
    write_board(out, manifest)
    flag = [(k, v) for k, v in out.items() if v["peak_db"] > -1.0 or v["clip"] > 0 or abs(v["dc"]) > 0.005]
    print(f"analysed {len(out)} assets; flagged peak/clip/dc: {[k for k, _ in flag]}")


def write_tables(out, manifest):
    rows = []
    for fid in sorted(out):
        r = out[fid]
        rows.append(r)
    with open(WORK / "qa.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "kind", "dur_s", "KB", "peak_dBFS", "truepeak_dBTP", "rms_dB", "LUFS_int", "gain", "DC", "clip_samples", "onset_ms", "head_dB", "tail_dB", "rolloff95_Hz", "centroid_Hz", "clicks", "seam_step_ratio", "seam_hf_ratio", "len_in", "len_dec"])
        for r in rows:
            w.writerow([r["id"], r.get("kind"), f"{r['dur']:.3f}", f"{r['bytes']/1024:.1f}", f"{r['peak_db']:.2f}", f"{r['true_peak_db']:.2f}", f"{r['rms_db']:.1f}", f"{r.get('lufs', float('nan')):.1f}", r.get("gain", ""),
                        f"{r['dc']:.5f}", r["clip"], f"{r['onset_ms']:.1f}", f"{r['head_db']:.0f}", f"{r['tail_db']:.0f}", f"{r['rolloff95']:.0f}", f"{r['centroid']:.0f}", r["n_clicks"], f"{r.get('seam_step_ratio', float('nan')):.2f}", f"{r.get('seam_hf_ratio', float('nan')):.2f}", r.get("samples_in", ""), r.get("samples_dec", "")])
    # markdown summary
    L = []
    sf = [r for r in rows if r.get("group") != "music"]
    mu = [r for r in rows if r.get("group") == "music"]
    L.append("# Audio QA (decoded MP3 measurements)\n")
    L.append(f"SFX files: {len(sf)}  total {sum(r['bytes'] for r in sf)/1e6:.2f} MB   |   music files: {len(mu)}  total {sum(r['bytes'] for r in mu)/1e6:.2f} MB\n")
    L.append("## Music\n\n| id | dur s | KB | LUFS int | peak dBFS | true peak | loudnorm in_i | seam step ratio | seam HF ratio | mono delta dB | len src/dec |\n|---|---|---|---|---|---|---|---|---|---|---|")
    for r in mu:
        ln = r.get("loudnorm", {})
        L.append(f"| {r['id']} | {r['dur']:.2f} | {r['bytes']/1024:.0f} | {r.get('lufs', float('nan')):.2f} | {r['peak_db']:.2f} | {r['true_peak_db']:.2f} | {ln.get('input_i', '')} | {r.get('seam_step_ratio', float('nan')):.2f} | {r.get('seam_hf_ratio', float('nan')):.2f} | {r.get('mono_delta_db', float('nan')):.2f} | {r.get('samples_in')}/{r.get('samples_dec')} |")
    L.append("\n## SFX\n\n| id | dur s | KB | peak | TP | LUFS(int) | gain | onset ms | tail dB | rolloff95 | clicks | flags |\n|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sf:
        flags = []
        if r["peak_db"] > -1.0:
            flags.append("PEAK")
        if r["clip"]:
            flags.append("CLIP")
        if abs(r["dc"]) > 0.003:
            flags.append("DC")
        if r["tail_db"] > -45 and not r.get("loop"):
            flags.append("ABRUPT-END")
        if r["onset_ms"] > 8 and r.get("group") in ("hit", "melee", "ui"):
            flags.append("LATE-ONSET")
        if r["n_clicks"]:
            flags.append("spikes@" + ",".join(f"{c[0]*1000:.0f}ms" for c in r["clicks"][:3]))
        L.append(f"| {r['id']} | {r['dur']:.2f} | {r['bytes']/1024:.1f} | {r['peak_db']:.1f} | {r['true_peak_db']:.1f} | {r.get('lufs', float('nan')):.1f} | {r.get('gain', '')} | {r['onset_ms']:.1f} | {r['tail_db']:.0f} | {r['rolloff95']:.0f} | {r['n_clicks']} | {' '.join(flags)} |")
    (WORK / "qa.md").write_text("\n".join(L), encoding="utf-8")


def write_board(out, manifest):
    base = "../../apps/game/public/"
    groups: dict[str, list] = {}
    for fid in sorted(out):
        r = out[fid]
        g = r.get("group", "misc")
        groups.setdefault(g, []).append(r)
    order = [k for k in ("music",) if k in groups] + sorted(k for k in groups if k != "music")
    H = ["""<!doctype html><meta charset="utf-8"><title>Metin Survivors - sound board</title>
<style>
body{font:14px/1.4 system-ui,Segoe UI,sans-serif;background:#15110f;color:#e8dcc0;margin:0;padding:20px 28px}
h1{color:#e0b24a;margin:0 0 4px}h2{color:#e0b24a;border-bottom:1px solid #4a3a2a;padding-bottom:4px;margin-top:30px;text-transform:capitalize}
.sub{color:#a89878;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}
.card{background:#211a15;border:1px solid #3d2f23;border-radius:8px;padding:8px 10px}
.card b{color:#f1d58a;font-weight:600}.card small{color:#a89878;display:block}
.card audio{width:100%;height:30px;margin-top:4px}
.card img{width:100%;border-radius:4px;margin-top:4px;display:none}
.card.open img{display:block}
button{background:#4a2a1c;color:#f1d58a;border:1px solid #7a4a2a;border-radius:5px;padding:3px 9px;cursor:pointer;margin-right:6px}
.music .card{grid-column:span 2}
.warn{color:#ff8a6a}
#bar{position:sticky;top:0;background:#15110f;padding:8px 0;z-index:5}
input[type=range]{vertical-align:middle}
</style><div id="bar"><h1>Metin Survivors &mdash; sound board</h1>
<div class="sub">All assets are original synthesis (tools/audiogen). Click a card title to show its spectrogram. Gain = manifest playback gain; the preview applies it when "apply manifest gain" is ticked.
<label><input type="checkbox" id="g" checked> apply manifest gain</label> &nbsp; master <input type="range" id="vol" min="0" max="1" step="0.01" value="0.6"></div></div>
<script>
const G=document.getElementById('g'),V=document.getElementById('vol');
function setup(a,gain){const upd=()=>{a.volume=Math.min(1,V.value*(G.checked?gain:1))};upd();V.addEventListener('input',upd);G.addEventListener('change',upd)}
</script>"""]
    for g in order:
        H.append(f'<h2>{html.escape(g)} ({len(groups[g])})</h2><div class="grid {"music" if g == "music" else ""}">')
        for r in groups[g]:
            fid = r["id"]
            m = manifest[fid]
            warn = ""
            if r["peak_db"] > -1.0 or r["clip"]:
                warn += " <span class=warn>PEAK/CLIP</span>"
            if r["n_clicks"]:
                warn += f" <span class=warn>{r['n_clicks']} spike(s)</span>"
            lufs = r.get("lufs")
            info = f"{r['dur']:.2f}s &middot; {r['bytes']/1024:.1f} KB &middot; peak {r['peak_db']:.1f} dBFS" + (f" &middot; {lufs:.1f} LUFS" if lufs is not None else "") + f" &middot; gain {m.get('gain', 1)}"
            loop = " loop" if (m.get("loop") and g != "music") else ""
            loopbtn = ""
            if m.get("loop"):
                loopbtn = f'<button onclick="const a=this.parentNode.querySelector(\'audio\');a.loop=!a.loop;this.textContent=a.loop?\'loop: on\':\'loop: off\'">loop: {"on" if g != "music" else "off"}</button>'
            seam = ""
            if "seam_step_ratio" in r:
                seam = f" &middot; seam step&times;{r['seam_step_ratio']:.2f}"
                if g == "music":
                    seam += f" <button onclick=\"const a=this.parentNode.querySelector('audio');a.loop=true;a.currentTime=Math.max(0,a.duration-4);a.play()\">test loop seam</button>"
            H.append(f'<div class="card"><b onclick="this.parentNode.classList.toggle(\'open\')" style="cursor:pointer">{html.escape(fid)}</b>{warn}<small>{info}{seam}</small>'
                     f'<audio controls preload="none" src="{base}{m["url"]}"{loop}></audio>{loopbtn}'
                     f'<img loading="lazy" src="spectrograms/{fid}.png"><script>setup(document.currentScript.parentNode.querySelector("audio"),{m.get("gain", 1)})</script></div>')
        H.append("</div>")
    BOARD.write_text("\n".join(H), encoding="utf-8")


if __name__ == "__main__":
    main()
