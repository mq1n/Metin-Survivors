// UI gallery (?ui=gallery[&screen=<id>][&lang=tr|en][&bare=1]): mounts the real UI against a mock store / meta / API so every
// screen and modal can be rendered and screenshotted without the engine or a live run. The scenarios (one per screen
// state) live in ui/dev/scenarios/*.ts, one module per target, collected here through import.meta.glob (see
// ui/dev/scenarioKit.ts), so builders never edit this file.
import { GameStore } from '../app/store';
import { loadContent } from '../app/content';
import type { ClassId, ContentDB, DoctrineKey } from '../data/schema';
import { Assets } from '../engine/assets';
import { Input } from '../engine/input';
import { settings } from '../engine/settings';
import { MemoryStore, MetaService, seededRng, treeView } from '../meta';
import type { SimEvent } from '../sim/events';
import { mountUi } from './index';
import type { UiEventSource } from './env';
import { MockApi, MockCoopLink } from './dev/mockApi';
import { mockEvent, mockHud, mockRunResult } from './dev/mock';
import { collectScenarios } from './dev/registry'; // keep after ./index (see registry.ts): CSS order + chunks
import { inRun, type Scenario } from './dev/scenarioKit';
import { subView } from './view';

class EventHub implements UiEventSource {
  private readonly fns = new Set<(e: SimEvent) => void>();
  subscribe(fn: (e: SimEvent) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(e: Record<string, unknown>): void {
    const ev = mockEvent(e);
    for (const fn of this.fns) fn(ev);
  }
}

export interface GalleryCtx {
  store: GameStore;
  meta: MetaService;
  content: ContentDB;
  events: EventHub;
  api: MockApi;
  classId: ClassId;
  doctrine: DoctrineKey;
  /** (re)starts the mock HUD ticker at run-time t */
  hud(opts?: { t?: number; boss?: boolean; hpFrac?: number; anim?: boolean }): void;
  stopHud(): void;
}

function reset(g: GalleryCtx): void {
  g.stopHud();
  g.store.setSimModal(null);
  g.store.setStory(null);
  g.store.setPaused(false);
  g.store.setResult(null);
  g.store.setHud(null);
  subView.value = 'main';
}

/** Every scenario (ui/dev/scenarios/*.ts via ./dev/registry), in picker order. */
const SCENARIOS: readonly Scenario[] = collectScenarios();

export const GALLERY_SCENARIOS: readonly { id: string; label: string }[] = SCENARIOS.map(({ id, label }) => ({ id, label }));

/** Builds a lived-in profile: a few settled runs, spent talent points, a bank balance. */
function seedProfile(meta: MetaService, content: ContentDB): void {
  const run = (over: Parameters<typeof mockRunResult>[1]): void => void meta.settle(mockRunResult(content, over), { submit: false });
  const zones = content.zones.map((z) => z.id);
  for (const z of zones.slice(0, 2)) {
    run({ zone: z, victory: true, classId: 'warrior', bossesKilled: content.zones.find((x) => x.id === z)?.bosses.map((b) => b.boss) ?? [] });
    run({ zone: z, victory: false, time: 520, kills: 2100, classId: 'warrior', bossesKilled: [] });
  }
  run({ zone: zones[0] ?? 'yeonmu', victory: true, classId: 'ninja', doctrine: 'a' });
  // spend most of the points the settlements earned; the last few stay unspent (the state a player opens Talents in)
  for (let i = 0; i < 18; i++) {
    let spent = false;
    for (const key of ['a', 'b'] as const) {
      const tv = treeView(content, meta.save.classes.warrior, 'warrior', key);
      const node = tv?.nodes.find((n) => n.canAllocate);
      if (node && tv) {
        meta.allocateTalent('warrior', key, node.node.id);
        spent = true;
        break;
      }
    }
    if (!spent) break;
  }
}

declare global {
  interface Window {
    /** DEV handle for screenshot scripts: `__ui.apply('levelUp')` */
    __ui?: GalleryCtx & { apply(id: string): void };
  }
}

const CLASS_IDS: readonly ClassId[] = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'];

export default async function gallery(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const langParam = q.get('lang');
  if (langParam === 'tr' || langParam === 'en') settings.update({ language: langParam });
  const root = document.getElementById('ui');
  if (!root) throw new Error('missing #ui');
  document.body.style.background = '#0b0806';

  const content = await loadContent();
  const assets = new Assets();
  await assets.init();
  const api = new MockApi();
  const meta = await MetaService.open({ content, store: new MemoryStore(), api, rng: seededRng(11), channel: null });
  seedProfile(meta, content);
  const store = new GameStore();
  const events = new EventHub();
  const input = new Input();
  input.attach();

  const classParam = q.get('class');
  const classId: ClassId = CLASS_IDS.find((c) => c === classParam) ?? 'warrior';
  const doctrine: DoctrineKey = q.get('doctrine') === 'b' ? 'b' : 'a';
  store.select({ classId, doctrine });

  let ticker: number | undefined;
  const g: GalleryCtx = {
    store,
    meta,
    content,
    events,
    api,
    classId,
    doctrine,
    hud: (opts = {}) => {
      window.clearInterval(ticker);
      let t = opts.t ?? 215;
      const push = (): void => store.setHud(mockHud(content, t, { classId, doctrine, ...(opts.boss ? { boss: true } : {}), ...(opts.hpFrac !== undefined ? { hpFrac: opts.hpFrac } : {}) }));
      push();
      if (opts.anim) {
        ticker = window.setInterval(() => {
          t += 0.1;
          push();
        }, 100);
      }
    },
    stopHud: () => window.clearInterval(ticker),
  };

  store.bind({
    chooseCard: () => store.setSimModal(null),
    reroll: () => {
      const m = store.modal.value;
      if (m && 'request' in m) store.setSimModal({ ...m.request, rerolls: Math.max(0, m.request.rerolls - 1), cards: [...m.request.cards].reverse() });
    },
    banish: () => {
      const m = store.modal.value;
      if (m && 'request' in m) store.setSimModal({ ...m.request, banishes: Math.max(0, m.request.banishes - 1), cards: [...m.request.cards].reverse() });
    },
    skip: () => store.setSimModal(null),
    pause: () => store.setPaused(true),
    resume: () => store.setPaused(false),
    quit: () => {
      reset(g);
      store.setResult(mockRunResult(content));
      store.setScreen('results');
    },
    go: (s) => {
      reset(g);
      store.setScreen(s);
    },
    startRun: () => {
      reset(g);
      store.setScreen('loading');
      let f = 0;
      const id = window.setInterval(() => {
        f += 0.12;
        store.setLoading({ fraction: Math.min(1, f), label: f < 0.4 ? 'content' : f < 0.8 ? 'models' : 'terrain', error: null });
        if (f >= 1) {
          window.clearInterval(id);
          inRun(g, { t: 0, anim: true });
        }
      }, 220);
    },
    dismissStory: () => store.setStory(null),
  });

  mountUi(root, { store, meta, content, assets, api, input, events, coopFactory: (room) => new MockCoopLink(room), version: 'dev' });

  const startId = q.get('screen') ?? 'menu';
  const apply = (id: string): void => {
    const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS.find((s) => s.id === 'menu') ?? SCENARIOS[0];
    if (!sc) return;
    reset(g);
    sc.run(g);
    const u = new URL(location.href);
    u.searchParams.set('screen', sc.id);
    history.replaceState(null, '', u);
  };
  apply(startId);

  if (q.get('bare') !== '1') {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:9999;display:flex;gap:6px;align-items:center;font:12px system-ui;background:rgba(0,0,0,.72);color:#e8c36a;padding:4px 8px;border-radius:6px;pointer-events:auto;opacity:.35';
    bar.onmouseenter = () => (bar.style.opacity = '1');
    bar.onmouseleave = () => (bar.style.opacity = '.35');
    const sel = document.createElement('select');
    sel.style.cssText = 'background:#1a1210;color:#f1e6c8;border:1px solid #6b4f1e;font:12px system-ui';
    for (const s of SCENARIOS) sel.add(new Option(s.label, s.id, false, s.id === startId));
    sel.onchange = () => apply(sel.value);
    const lang = document.createElement('button');
    lang.textContent = 'TR/EN';
    lang.style.cssText = 'background:#1a1210;color:#f1e6c8;border:1px solid #6b4f1e;font:12px system-ui;cursor:pointer';
    lang.onclick = () => settings.update({ language: settings.value.language === 'tr' ? 'en' : 'tr' });
    bar.append(sel, lang);
    document.body.appendChild(bar);
  }
  window.__ui = Object.assign(g, { apply });
}
