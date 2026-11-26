// DEV audio bench: ?demo=audio — one button per manifest sound; music buttons; live master meter. Exposes window.__audioDemo.
import type { AudioAsset } from '../../data/assetManifest';
import { createAudio, type MusicMode } from '../../audio';

export default async function run(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}assets/manifest/audio.json`, { cache: 'no-cache' });
  const manifest = (await res.json()) as Record<string, AudioAsset>;
  const audio = createAudio(manifest, null, {});

  document.body.style.cssText = 'background:#15110f;color:#e8dcc0;font:13px system-ui;overflow:auto;position:static;height:auto';
  const root = document.createElement('div');
  root.style.cssText = 'padding:12px 16px;max-width:1200px';
  document.body.appendChild(root);
  const head = document.createElement('div');
  head.innerHTML = '<b style="color:#e0b24a;font-size:16px">Audio bench</b> &mdash; click anywhere first (autoplay policy). ';
  const status = document.createElement('span');
  const meter = document.createElement('div');
  meter.style.cssText = 'height:8px;background:#3a2c20;margin:6px 0;width:400px';
  const bar = document.createElement('div');
  bar.style.cssText = 'height:8px;width:0;background:#e0b24a';
  meter.appendChild(bar);
  root.append(head, status, meter);

  const mk = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:2px;padding:3px 7px;background:#4a2a1c;color:#f1d58a;border:1px solid #7a4a2a;border-radius:4px;cursor:pointer';
    b.onclick = fn;
    return b;
  };
  const music = document.createElement('div');
  const modes: [string, string, MusicMode][] = [['menu', 'menu', 'menu']];
  for (const z of ['yeonmu', 'suryeon', 'seori', 'daeryeol']) for (const m of ['calm', 'combat', 'boss'] as const) modes.push([`${z} ${m}`, z, m]);
  modes.push(['stop', 'menu', 'off']);
  for (const [label, zone, mode] of modes) music.appendChild(mk(label, () => audio.setZoneMusic(zone, mode)));
  root.appendChild(music);
  const sfx = document.createElement('div');
  for (const id of Object.keys(manifest).filter((k) => !/_\d\d$/.test(k) && k.startsWith('sfx_')).sort()) sfx.appendChild(mk(id.replace('sfx_', ''), () => audio.playUi(id)));
  root.appendChild(sfx);

  const data = new Float32Array(2048);
  const tick = (): void => {
    const an = audio.analyser();
    if (an) {
      an.getFloatTimeDomainData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) s += (data[i] ?? 0) ** 2;
      bar.style.width = `${Math.min(400, Math.sqrt(s / data.length) * 1600)}px`;
    }
    const st = audio.stats;
    status.textContent = `unlocked=${audio.unlocked} voices=${st.voices} started=${st.started} dropped=${st.dropped} music=${st.music.split('/').pop() ?? ''}`;
    requestAnimationFrame(tick);
  };
  tick();

  const rms = (): number => {
    const an = audio.analyser();
    if (!an) return -1;
    let peak = 0;
    for (let k = 0; k < 4; k++) {
      an.getFloatTimeDomainData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) s += (data[i] ?? 0) ** 2;
      peak = Math.max(peak, Math.sqrt(s / data.length));
    }
    return peak;
  };
  (window as unknown as { __audioDemo: unknown }).__audioDemo = { audio, manifest, rms };
}
