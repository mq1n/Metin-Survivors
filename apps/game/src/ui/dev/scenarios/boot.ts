// Gallery scenarios: boot splash + run loading (owner: B1 boot-loading). Every loading scenario sets the whole run selection it
// shows (zone, hero, doctrine, difficulty), so the order in which scenarios are applied never leaks a previous choice.
import { loadFailureMessage } from '../../../app/loadFailure';
import type { ClassId, Difficulty, DoctrineKey } from '../../../data/schema';
import type { GalleryCtx } from '../../gallery';
import type { Scenario } from '../scenarioKit';

export const order = 10;

interface Look {
  zone: string;
  classId?: ClassId;
  doctrine?: DoctrineKey;
  difficulty?: Difficulty;
  fraction: number;
  label: string;
  error?: string | null;
}

function loadingAt(g: GalleryCtx, look: Look): void {
  g.store.select({
    zone: look.zone,
    classId: look.classId ?? g.classId,
    doctrine: look.doctrine ?? g.doctrine,
    difficulty: look.difficulty ?? 'normal',
  });
  g.store.setLoading({ fraction: look.fraction, label: look.label, error: null });
  g.store.setScreen('loading');
  if (look.error) g.store.failLoading(look.error);
}

export const scenarios: Scenario[] = [
  {
    id: 'boot',
    label: 'Boot',
    run: (g) => {
      g.store.setLoading({ fraction: 0.86, label: 'ui', error: null });
      g.store.setScreen('boot');
    },
  },
  {
    id: 'boot-start',
    label: 'Boot · early',
    run: (g) => {
      g.store.setLoading({ fraction: 0.42, label: 'assets', error: null });
      g.store.setScreen('boot');
    },
  },
  {
    id: 'boot-full',
    label: 'Boot · ready',
    run: (g) => {
      g.store.setLoading({ fraction: 1, label: 'ready', error: null });
      g.store.setScreen('boot');
    },
  },
  {
    id: 'loading',
    label: 'Run loading',
    run: (g) => loadingAt(g, { zone: 'yeonmu', fraction: 0.63, label: 'terrain' }),
  },
  {
    id: 'loading-suryeon',
    label: 'Run loading · Suryeon (hard)',
    run: (g) => loadingAt(g, { zone: 'suryeon', classId: 'ninja', doctrine: 'b', difficulty: 'hard', fraction: 0.34, label: 'models' }),
  },
  {
    id: 'loading-seori',
    label: 'Run loading · Seori',
    run: (g) => loadingAt(g, { zone: 'seori', classId: 'shaman', doctrine: 'a', fraction: 0.81, label: 'terrain' }),
  },
  {
    id: 'loading-daeryeol',
    label: 'Run loading · Daeryeol (hard)',
    run: (g) => loadingAt(g, { zone: 'daeryeol', classId: 'yacha', doctrine: 'b', difficulty: 'hard', fraction: 0.12, label: 'content' }),
  },
  {
    id: 'loading-start',
    label: 'Run loading · just started',
    run: (g) => loadingAt(g, { zone: 'yeonmu', fraction: 0, label: 'content' }),
  },
  {
    id: 'loading-error',
    label: 'Run loading · failed',
    run: (g) =>
      loadingAt(g, {
        zone: 'yeonmu',
        fraction: 0.63,
        label: 'terrain',
        error: loadFailureMessage(new Error('Failed to fetch assets/models/enemy/orc_scout.4f1c2a9e.glb (HTTP 503)')),
      }),
  },
];
