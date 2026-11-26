// DEV-only debug UI (plain DOM) to drive the vertical slice until the real Preact screens land.
// Mounted by app/app.ts when `?dev` is present or when src/ui/mount.ts does not exist yet.
import { effect } from '@preact/signals';
import type { App } from '../app/app';
import type { ModalRequest } from '../sim/types';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (css) el.style.cssText = css;
  if (text) el.textContent = text;
  return el;
}

const BTN =
  'font:12px ui-monospace,Consolas,monospace;color:#f4e6c8;background:#4a1f14;border:1px solid #b88a3c;border-radius:3px;padding:4px 8px;margin:2px;cursor:pointer';
const PANEL =
  'position:fixed;color:#e8dcc0;font:12px/1.4 ui-monospace,Consolas,monospace;background:rgba(12,8,6,.82);border:1px solid #6b4a24;border-radius:4px;padding:8px 10px;z-index:50';

function button(label: string, on: () => void): HTMLButtonElement {
  const b = h('button', BTN, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    on();
    (document.getElementById('game') as HTMLCanvasElement | null)?.focus();
  });
  return b;
}

export function mountDevUi(root: HTMLElement, app: App): void {
  const store = app.store;
  const side = h('div', `${PANEL};right:8px;top:8px;min-width:220px;max-width:320px`);
  const center = h('div', `${PANEL};left:50%;top:50%;transform:translate(-50%,-50%);min-width:420px;display:none`);
  const hud = h('div', `${PANEL};left:8px;bottom:8px;min-width:300px;display:none`);
  const bossBar = h('div', `${PANEL};left:50%;top:8px;transform:translateX(-50%);min-width:320px;display:none;text-align:center`);
  const toasts = h('div', `position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:60;pointer-events:none;text-align:center;font:14px ui-monospace,monospace;color:#ffe9a8;text-shadow:0 1px 3px #000`);
  root.append(side, center, hud, bossBar, toasts);

  // --- side panel: navigation + dev tools ---
  effect(() => {
    const screen = store.screen.value;
    side.replaceChildren();
    side.append(h('div', 'font-weight:bold;color:#ffd77a', `Metin Survivors · dev · ${screen} · ${store.fps.value} fps`));
    const err = store.loading.value.error;
    if (err) side.append(h('div', 'color:#ff8a7a;white-space:pre-wrap', err));
    if (screen === 'menu' || screen === 'results') {
      side.append(button('Start run', () => store.startRun()));
      if (screen === 'results') side.append(button('Menu', () => store.go('menu')));
    }
    if (screen === 'loading') {
      const l = store.loading.value;
      side.append(h('div', '', `loading ${l.label} ${(l.fraction * 100).toFixed(0)}%`));
    }
    if (screen === 'run') {
      const row1 = h('div');
      row1.append(
        button(store.paused.value ? 'Resume' : 'Pause', () => (store.paused.value ? store.resume() : store.pause())),
        button('Abandon', () => store.quit()),
      );
      const row2 = h('div', '', 'time ×');
      for (const s of [0.25, 1, 2, 4, 8]) row2.append(button(String(s), () => (app.loop.timeScale = s)));
      const row3 = h('div', '', 'jump ');
      const jumps: [string, number][] = [
        ['0:55', 55],
        ['2:50', 170],
        ['5:50', 350],
        ['14:50', 890],
      ];
      for (const [label, t] of jumps) row3.append(button(label, () => app.session && (app.session.world.time = t)));
      const row4 = h('div');
      row4.append(
        button('Heal', () => {
          const p = app.session?.world.players[0];
          if (p) p.hp = p.hpMax;
        }),
        button('+XP', () => {
          const p = app.session?.world.players[0];
          if (p) p.xp = Math.max(p.xp, p.xpNext);
        }),
        button('Perf', () => app.renderWorld.perf.toggle()),
      );
      side.append(row1, row2, row3, row4);
      const w = app.session?.world;
      if (w) side.append(h('div', 'opacity:.7', `enemies ${w.enemies.count} proj ${w.projectiles.count} pickups ${w.pickups.count} metins ${w.metins.length}`));
    }
  });

  // --- HUD readout (10 Hz via the store) ---
  effect(() => {
    const s = store.hud.value;
    const screen = store.screen.value;
    hud.style.display = screen === 'run' && s ? 'block' : 'none';
    bossBar.style.display = screen === 'run' && s?.boss ? 'block' : 'none';
    if (!s) return;
    const mm = Math.floor(s.time / 60);
    const ss = Math.floor(s.time % 60);
    hud.replaceChildren(
      h('div', 'color:#ffd77a', `${mm}:${String(ss).padStart(2, '0')}  Lv ${s.level}  kills ${s.kills}  yeop ${s.yeop}  shards ${s.shards}`),
      bar('HP', s.hp / Math.max(1, s.hpMax), '#c93a2e', `${Math.ceil(s.hp)}/${Math.ceil(s.hpMax)}${s.shield > 0 ? ` +${Math.ceil(s.shield)}` : ''}`),
      bar('XP', s.xp / Math.max(1, s.xpNext), '#4a9bff', `${Math.floor(s.xp)}/${Math.floor(s.xpNext)}`),
      h('div', 'opacity:.8', `corruption ${(s.corruption * 100).toFixed(0)}%` + (s.nextBoss ? `  next boss ${s.nextBoss.id} in ${Math.ceil(s.nextBoss.in)}s` : '')),
      h('div', 'opacity:.8', s.skills.map((k) => `${k.id}[${k.rank}]${k.cooldown > 0.01 ? '…' : ''}`).join('  ')),
    );
    if (s.boss) {
      bossBar.replaceChildren(h('div', 'color:#ff9a7a', `${s.boss.id}${s.boss.enraged ? ' (ENRAGED)' : ''} · phase ${s.boss.phase + 1}`), bar('', s.boss.hp / Math.max(1, s.boss.hpMax), '#8c1d1d', `${Math.ceil(s.boss.hp)}`));
    }
  });

  // --- modals ---
  effect(() => {
    const m = store.modal.value;
    center.replaceChildren();
    center.style.display = m ? 'block' : 'none';
    if (!m) return;
    if (m.kind === 'pause') {
      center.append(h('div', 'font-size:16px;color:#ffd77a', 'PAUSED'), button('Resume (Esc)', () => store.resume()), button('Abandon run', () => store.quit()));
    } else if (m.kind === 'story') {
      center.append(h('div', 'color:#ffd77a', `story: ${m.story.kind} · ${m.story.ref}`), button('Continue (Enter)', () => store.dismissStory()));
    } else if (m.kind === 'runEnd') {
      const r = m.request.result;
      center.append(h('div', 'font-size:16px;color:#ffd77a', r?.victory ? 'VICTORY' : 'DEFEAT'));
      if (r) {
        center.append(
          h('div', '', `time ${Math.floor(r.time)}s · kills ${r.kills} · level ${r.level} · yeop ${r.yeop} · metins ${r.metinsBroken} · bosses ${r.bossesKilled.length}`),
          h('div', 'opacity:.8', r.damageBySkill.slice(0, 5).map((d) => `${d.skillId} ${Math.round(d.damage)}`).join(' · ')),
        );
      }
      center.append(button('Continue', () => store.quit()));
    } else {
      renderCards(center, m.kind, m.request, store);
    }
  });

  // --- toasts ---
  effect(() => {
    toasts.replaceChildren(...store.toasts.value.map((t) => h('div', '', `${t.kind} ${JSON.stringify(t.data)}`)));
  });
}

function bar(label: string, frac: number, color: string, text: string): HTMLElement {
  const wrap = h('div', 'display:flex;align-items:center;gap:6px;margin:2px 0');
  if (label) wrap.append(h('span', 'width:22px;opacity:.8', label));
  const outer = h('div', 'flex:1;height:12px;background:#1b1210;border:1px solid #5a3b1a;position:relative');
  const inner = h('div', `height:100%;width:${Math.max(0, Math.min(1, frac)) * 100}%;background:${color}`);
  outer.append(inner);
  wrap.append(outer, h('span', 'min-width:70px;text-align:right', text));
  return wrap;
}

function renderCards(host: HTMLElement, kind: string, req: ModalRequest, store: App['store']): void {
  host.append(h('div', 'font-size:15px;color:#ffd77a', `${kind}${kind === 'levelUp' ? ` · level ${req.level}` : ''}${req.source ? ` · ${req.source}` : ''}`));
  const rarityColor: Record<string, string> = { common: '#bbb', uncommon: '#6fd36f', rare: '#5aa0ff', epic: '#c17aff', legendary: '#ffb040' };
  req.cards.forEach((c, i) => {
    const row = h('div', `margin:6px 0;padding:6px;border:1px solid ${rarityColor[c.rarity] ?? '#888'};border-radius:3px;display:flex;gap:8px;align-items:center`);
    const label = `${i + 1}. [${c.rarity}] ${c.kind} ${c.id} → rank ${c.rank}/${c.maxRank}${c.awakening ? ' ★AWAKEN' : ''}${c.replaces ? ` (replaces ${c.replaces.id})` : ''}`;
    const lines = c.lines.map((l) => `${l.stat} ${l.mode === 'pct' ? `${(l.value * 100).toFixed(0)}%` : l.value.toFixed(2)}`).join(', ');
    const col = h('div', 'flex:1');
    col.append(h('div', `color:${rarityColor[c.rarity] ?? '#ddd'}`, label), h('div', 'opacity:.75', lines || (c.amount ? `amount ${c.amount}` : '')));
    row.append(col, button(`Pick ${i + 1}`, () => store.chooseCard(i)), button('Ban', () => store.banish(i)));
    host.append(row);
  });
  const foot = h('div');
  foot.append(
    button(`Reroll (${req.rerolls})`, () => store.reroll()),
    button(`Skip (${req.skips})`, () => store.skip()),
    h('span', 'opacity:.7', `  keys 1-${req.cards.length} · R reroll · X skip · B+n banish (${req.banishes})`),
  );
  host.append(foot);
}
