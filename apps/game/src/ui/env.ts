// Runtime dependencies of the UI (one UI instance per page). `mountUi` stores them here; components read them through
// `deps()` / the small helpers below. Everything optional degrades gracefully (no audio → silent, no api → offline-only…).
import type { GameStore } from '../app/store';
import type { ClassId, ContentDB, DoctrineKey, EmpireId, Sex } from '../data/schema';
import type { Assets } from '../engine/assets';
import type { Input } from '../engine/input';
import type { CloudApi, MetaService } from '../meta';
import type { ApiClient } from '../net/api';
import type { CoopTransport } from '../net/transport';
import type { SimEvent } from '../sim/events';

export interface UiAudio {
  playUi(id: string): void;
}

export interface HeroPreviewSelection {
  classId: ClassId;
  sex: Sex;
  doctrine: DoctrineKey;
  empire: EmpireId;
  armorTier: number;
}

export interface HeroPreviewHandle {
  update(sel: HeroPreviewSelection): void;
  dispose(): void;
}

/** Engine hook: renders the selected hero into a DOM container (hero-select screen). */
export interface HeroPreviewHook {
  mount(container: HTMLElement, sel: HeroPreviewSelection): HeroPreviewHandle;
}

/** CSS-pixel viewport position of a world point; `behind` = behind the camera plane (arrow should point away). */
export interface ScreenPoint {
  x: number;
  y: number;
  behind: boolean;
}
export type ProjectFn = (x: number, z: number) => ScreenPoint | null;

/** `runEvents` (app/runEvents.ts) satisfies this. */
export interface UiEventSource {
  subscribe(fn: (e: SimEvent) => void): () => void;
  subscribeLifecycle?(l: { runStart?(): void; runEnd?(): void; pauseChanged?(paused: boolean): void }): () => void;
}

/** What the UI needs from the HTTP client (net/api.ts `api` satisfies it; the gallery supplies a mock). */
export type UiApi = CloudApi & Pick<ApiClient, 'createRoom' | 'coopSocketUrl' | 'getCredentials' | 'pendingRuns' | 'health'>;

/** The co-op transport surface the lobby uses (`CoopTransport` satisfies it; the gallery supplies a mock). */
export type CoopLink = Pick<CoopTransport, 'state' | 'room' | 'slot' | 'host' | 'phase' | 'players' | 'isHost' | 'latencyMs' | 'on' | 'connect' | 'join' | 'start' | 'leave' | 'close'>;

export interface UiDeps {
  store: GameStore;
  meta: MetaService;
  content: ContentDB;
  assets: Assets;
  api?: UiApi;
  /** builds the co-op transport for a room code; default `CoopTransport.forRoom(api, room)` */
  coopFactory?: (room: string) => CoopLink;
  audio?: UiAudio;
  input?: Input;
  events?: UiEventSource;
  heroPreview?: HeroPreviewHook;
  project?: ProjectFn;
  /** build/version label shown in the menu footer */
  version?: string;
}

let current: UiDeps | null = null;

export function setDeps(d: UiDeps | null): void {
  current = d;
}

export function deps(): UiDeps {
  if (!current) throw new Error('UI used before mountUi()');
  return current;
}

export function hasDeps(): boolean {
  return current !== null;
}
