"""Spectrogram / waveform rendering for self-QA (matplotlib, Agg backend)."""
from __future__ import annotations

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from scipy import signal as sps  # noqa: E402

from .dsp import SR  # noqa: E402


def spectrogram_png(x, path, title="", max_freq=20000, nfft=1024, wave=True, dpi=90, size=(9.0, 4.2), label_sec=None):
    x = np.asarray(x)
    mono = x if x.ndim == 1 else x.mean(0)
    n = len(mono)
    nfft = nfft if n > 4 * nfft else 256
    f, t, S = sps.spectrogram(mono, SR, window="hann", nperseg=nfft, noverlap=int(nfft * 0.875), mode="magnitude")
    Sdb = 20 * np.log10(np.maximum(S, 1e-7))
    vmax = Sdb.max()
    fig = plt.figure(figsize=size, dpi=dpi)
    if wave:
        gs = fig.add_gridspec(2, 1, height_ratios=[1, 3], hspace=0.06)
        ax0 = fig.add_subplot(gs[0])
        step = max(1, n // 4000)
        tt = np.arange(0, n, step) / SR
        seg = mono[: (n // step) * step].reshape(-1, step)
        ax0.fill_between(tt[: seg.shape[0]], seg.min(1), seg.max(1), color="#2a6", lw=0.5)
        ax0.set_xlim(0, n / SR)
        ax0.set_ylim(-1, 1)
        ax0.set_xticklabels([])
        ax0.set_title(title, fontsize=9)
        ax0.tick_params(labelsize=7)
        ax1 = fig.add_subplot(gs[1])
    else:
        ax1 = fig.add_subplot(111)
        ax1.set_title(title, fontsize=9)
    ax1.pcolormesh(t, f, Sdb, vmin=vmax - 90, vmax=vmax, cmap="magma", shading="auto")
    ax1.set_ylim(30, max_freq)
    ax1.set_yscale("symlog", linthresh=1000, linscale=1.2)
    ax1.set_yticks([50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000])
    ax1.set_yticklabels(["50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"])
    ax1.tick_params(labelsize=7)
    ax1.set_xlabel("s", fontsize=7)
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def sheet_png(items, path, cols=3, size=(5.2, 2.2), dpi=80, max_freq=20000):
    """Contact sheet of several spectrograms: items = [(title, signal)]."""
    rows = -(-len(items) // cols)
    fig, axes = plt.subplots(rows, cols, figsize=(size[0] * cols, size[1] * rows), dpi=dpi, squeeze=False)
    for ax in axes.ravel():
        ax.axis("off")
    for (title, x), ax in zip(items, axes.ravel()):
        x = np.asarray(x)
        mono = x if x.ndim == 1 else x.mean(0)
        nfft = 1024 if len(mono) > 4096 else 256
        f, t, S = sps.spectrogram(mono, SR, window="hann", nperseg=nfft, noverlap=int(nfft * 0.875), mode="magnitude")
        Sdb = 20 * np.log10(np.maximum(S, 1e-7))
        ax.axis("on")
        ax.pcolormesh(t, f, Sdb, vmin=Sdb.max() - 90, vmax=Sdb.max(), cmap="magma", shading="auto")
        ax.set_ylim(30, max_freq)
        ax.set_yscale("symlog", linthresh=1000, linscale=1.2)
        ax.set_yticks([100, 500, 2000, 10000])
        ax.set_yticklabels(["100", "500", "2k", "10k"])
        ax.tick_params(labelsize=6)
        ax.set_title(title, fontsize=7)
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
