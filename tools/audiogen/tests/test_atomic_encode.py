"""Regression tests for atomic audio publishing in audiogen.build.do_encode."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

AUDIOGEN_ROOT = Path(__file__).resolve().parents[1]
if str(AUDIOGEN_ROOT) not in sys.path:
    sys.path.insert(0, str(AUDIOGEN_ROOT))

from audiogen import build  # noqa: E402


def _seed_published(pub: Path) -> dict[str, Path]:
    files = {
        "sfx": pub / "assets" / "audio" / "sfx" / "sfx_hit.old11111.mp3",
        "music": pub / "assets" / "audio" / "music" / "mus_menu.old22222.mp3",
        "ambience": pub / "assets" / "audio" / "ambience" / "amb_yeonmu.old33333.mp3",
        "manifest": pub / "assets" / "manifest" / "audio.json",
    }
    for k, p in files.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        if k == "manifest":
            p.write_text(json.dumps({"sfx_hit": {"url": "assets/audio/sfx/sfx_hit.old11111.mp3"}}))
        else:
            p.write_bytes(f"existing-{k}".encode())
    return files


def test_do_encode_preserves_existing_published_files_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    pub = tmp_path / "public"
    work = tmp_path / "work"
    work.mkdir(parents=True, exist_ok=True)
    seeded = _seed_published(pub)

    monkeypatch.setattr(build, "PUB", pub)
    monkeypatch.setattr(build, "AUDIO_DIR", pub / "assets" / "audio")
    monkeypatch.setattr(build, "MANIFEST", pub / "assets" / "manifest" / "audio.json")
    monkeypatch.setattr(build, "WORK", work)
    monkeypatch.setattr(build, "QA_JSON", work / "qa.json")
    monkeypatch.setattr(build, "rendered_beds", lambda: ["amb_yeonmu"])
    monkeypatch.setattr(build, "load_sfx", lambda: {})

    def failing_encode(root: Path, workers: int, only=None):
        # Must be encoding into a staging directory, never directly into `pub`.
        assert Path(root).resolve() != pub.resolve()
        raise RuntimeError("ffmpeg missing or source WAV absent")

    monkeypatch.setattr(build, "encode_catalogue", failing_encode)

    with pytest.raises(RuntimeError, match="ffmpeg missing"):
        build.do_encode(workers=1)

    # Every previously published audio file and manifest must remain completely untouched.
    for key, path in seeded.items():
        assert path.exists(), f"{key} was deleted before replacements succeeded"
        if key != "manifest":
            assert path.read_bytes() == f"existing-{key}".encode()
    assert json.loads(seeded["manifest"].read_text())["sfx_hit"]["url"].endswith(".old11111.mp3")


def test_do_encode_replaces_atomically_and_prunes_stale_only_after_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    pub = tmp_path / "public"
    work = tmp_path / "work"
    work.mkdir(parents=True, exist_ok=True)
    seeded = _seed_published(pub)

    monkeypatch.setattr(build, "PUB", pub)
    monkeypatch.setattr(build, "AUDIO_DIR", pub / "assets" / "audio")
    monkeypatch.setattr(build, "MANIFEST", pub / "assets" / "manifest" / "audio.json")
    monkeypatch.setattr(build, "WORK", work)
    monkeypatch.setattr(build, "QA_JSON", work / "qa.json")
    monkeypatch.setattr(build, "rendered_beds", lambda: [])

    class DummyDef:
        id = "sfx_hit"
        kind = "sfx"
        group = "combat"
        level_db = 0.0
        loop = False
        variants = 1

    monkeypatch.setattr(build, "load_sfx", lambda: {"sfx_hit": DummyDef()})

    def ok_encode(root: Path, workers: int, only=None):
        root = Path(root)
        assert root.resolve() != pub.resolve()
        # While encoding, old published files must still exist untouched.
        assert seeded["sfx"].exists()
        assert seeded["music"].exists()
        rel = "assets/audio/sfx/sfx_hit.new99999.mp3"
        out = root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"new-mp3-bytes")
        res = [
            dict(
                id="sfx_hit",
                file=rel,
                bytes=13,
                samples_in=4410,
                samples_dec=4410,
                applied_gain_db=0.0,
                peak_db=-2.0,
                channels=1,
            )
        ]
        return res, {"sfx_hit": DummyDef()}, {}, []

    monkeypatch.setattr(build, "encode_catalogue", ok_encode)
    monkeypatch.setattr(build, "ff_decode", lambda mp3, ch: np.zeros(4410, dtype=np.float64))
    monkeypatch.setattr(build, "short_term_max_lufs", lambda x: -14.0)

    build.do_encode(workers=1)

    new_sfx = pub / "assets" / "audio" / "sfx" / "sfx_hit.new99999.mp3"
    assert new_sfx.exists()
    assert new_sfx.read_bytes() == b"new-mp3-bytes"
    assert not seeded["sfx"].exists()  # stale sfx file removed only after replacement succeeded
    assert seeded["ambience"].exists()  # ambience preserved because rendered_beds() was empty
    manifest = json.loads(seeded["manifest"].read_text())
    assert manifest["sfx_hit"]["url"] == "assets/audio/sfx/sfx_hit.new99999.mp3"
