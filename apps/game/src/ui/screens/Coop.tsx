// Co-op lobby (transport only): create / join a room by code, 4 party slots with live roster, ready toggle, host-only
// start (zone + difficulty), connection states (connecting / reconnecting / error / closed), "match starting" state.
// The transport is always closed when the lobby unmounts or the player leaves. Presentation: one board window per state
// (gate, lobby) on the UI kit, content on the pebbled board in pewter trays — a carved room-code plate, party slot cards
// (portrait in a pewter frame, lit-leather ready strap, host tag, empire banner), a ready-pip dock with a fixed START / READY

import { signal } from '@preact/signals';
import { ROOM_CODE_LENGTH, ZONE_IDS, isRoomCode, normalizeCode, validateDisplayName, type Difficulty, type ZoneId } from '@ms/shared/api';
import { COOP_CLOSE, COOP_MAX_PLAYERS, type CoopErrorCode, type Loadout, type LobbyPlayer, type RoomPhase } from '@ms/shared/coop';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RunSelection } from '../../app/store';
import { t, tl } from '../../i18n/i18n';
import { CLASS_IDS, classifyCloudError, publicProfileName, zoneStatuses } from '../../meta';
import type { ApiClient } from '../../net/api';
import { CoopTransport } from '../../net/transport';
import { portraitUrl, zoneArtUrl } from '../assets';
import { sfx } from '../audio';
import { Button } from '../components/Button';
import { Segmented } from '../components/Controls';
import { EmberField } from '../components/Modal';
import { Panel } from '../components/Panel';
import { StatWell } from '../components/StatWell';
import { KeyCap, UiGlyph } from '../components/StatIcon';
import { TipBody, tipProps } from '../components/Tooltip';
import { className, indexOf, zoneName } from '../content';
import { deps, type CoopLink } from '../env';
import { layout } from '../layout';
import { useKeys, useScope } from '../nav';
import { closeView, pushToast, registerCoopLobbyReset } from '../view';
import { ClassEmblem, ClassSeal, CopyGlyph, CrownMedal, EmpireBanner, EmptySeat, GlyphSeal, OlTag, ShareGlyph, StateSeal, ZoneTab, leatherStyle } from './onlineArt';
import { OlScroll } from './onlineScroll';
import { copyWithToast, failureText, useNow } from './onlineShared';
import './online.css';
import './coop.css';

/** The room the lobby is in (module-level so the gallery can open a lobby directly). Cleared on leave / back. */
export const coopRoom = signal<string | null>(null);

/** Room left through "Change hero" — offered as a one-click rejoin when the player returns. */
let rejoinRoom: string | null = null;

// a finished co-op run's "Main menu" forgets the room instead of reopening its dead lobby (view.ts leaveCoopForMenu)
registerCoopLobbyReset(() => {
  coopRoom.value = null;
  rejoinRoom = null;
});

const SLOT_IDS = [0, 1, 2, 3] as const;

/** How long a "joined the room" toast stays up (view.ts default); a join inside this window merges into it. */
const JOIN_TOAST_MS = 2600;

function loadoutOf(sel: RunSelection): Loadout {
  return {
    classId: sel.classId,
    doctrine: sel.doctrine,
    sex: sel.sex,
    empire: sel.empire,
    tier: Math.min(3, Math.max(0, Math.round(sel.armorTier))),
  };
}

function doctrineName(l: Loadout): string {
  const cls = indexOf().classes.get(l.classId);
  const d = cls?.doctrines.find((x) => x.id === l.doctrine);
  return d ? tl(d.name) : l.doctrine.toUpperCase();
}

function empireName(l: Loadout): string {
  const e = indexOf().empires.get(l.empire);
  return e ? tl(e.name) : l.empire;
}

function closeText(code: number | undefined): string {
  switch (code) {
    case COOP_CLOSE.replaced:
      return t('coop.close.replaced');
    case COOP_CLOSE.idle:
      return t('coop.close.idle');
    case COOP_CLOSE.roomClosed:
      return t('coop.close.roomClosed');
    case COOP_CLOSE.rateAbuse:
      return t('coop.close.rateAbuse');
    case COOP_CLOSE.policy:
      return t('coop.close.policy');
    default:
      return t('coop.close.other');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pieces

/** The six-cell engraved code plate (display only). Empty cells stay empty: the example code is a caption, never a ghost. */
function RoomCode({ code, caret }: { code: string; caret?: number }): JSX.Element {
  return (
    <span class="ms-co-code">
      {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => {
        const ch = code[i] ?? '';
        return (
          <i key={i} class={`ms-co-cell ms-num ${ch ? 'is-set' : ''} ${caret === i ? 'is-caret' : ''}`}>
            {ch}
          </i>
        );
      })}
    </span>
  );
}

/** Join-code entry: the cells show the typed characters, a transparent input on top takes the typing (paste works). */
function CodeInput({ value, onInput, onEnter, label }: { value: string; onInput: (v: string) => void; onEnter: () => void; label: string }): JSX.Element {
  const [focus, setFocus] = useState(false);
  return (
    <label class={`ms-co-codein ${focus ? 'is-focus' : ''}`}>
      <RoomCode code={value} caret={focus && value.length < ROOM_CODE_LENGTH ? value.length : undefined} />
      <input
        class="ms-co-codein-input"
        type="text"
        value={value}
        maxLength={ROOM_CODE_LENGTH + 2}
        autocapitalize="characters"
        autocomplete="off"
        autocorrect="off"
        spellcheck={false}
        enterkeyhint="go"
        data-nav=""
        aria-label={label}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </label>
  );
}

/** Hero card for the local player's current selection (the loadout that is sent to the room). */
function LoadoutCard({ onChange, stage }: { onChange: () => void; stage?: boolean }): JSX.Element {
  const sel = deps().store.selection.value;
  const l = loadoutOf(sel);
  const art = portraitUrl(l.classId, l.sex);
  const tags = (
    <span class="ms-co-loadout-line">
      <OlTag>{doctrineName(l)}</OlTag>
      <span class="ms-co-empire">
        <EmpireBanner empire={l.empire} width="2.7rem" />
        {empireName(l)}
      </span>
      <OlTag tone="gold">{t('coop.loadout.tier', { n: l.tier + 1 })}</OlTag>
    </span>
  );
  if (stage) {
    return (
      <div class="ms-co-loadout ms-co-loadout--stage">
        <span class="ms-ol-eyebrow">{t('coop.loadout.title')}</span>
        <span class="ms-co-stage ms-plate" style={art ? `--art:url("${art}")` : ''}>
          <span class="ms-co-stage-cap">{className(l.classId)}</span>
          <span class="ms-co-stage-flag">
            <EmpireBanner empire={l.empire} width="4.8rem" title={empireName(l)} />
          </span>
        </span>
        {tags}
        <Button variant="wood" size="small" onClick={onChange}>
          {t('coop.loadout.change')}
        </Button>
      </div>
    );
  }
  return (
    <div class="ms-co-loadout ms-co-loadout--bar">
      <ClassSeal classId={l.classId} sex={l.sex} size="4.8rem" />
      <div class="ms-co-loadout-body">
        <span class="ms-ol-eyebrow">{t('coop.loadout.title')}</span>
        <b class="ms-head ms-co-loadout-name">{className(l.classId)}</b>
        {tags}
      </div>
      <Button variant="wood" size="small" onClick={onChange}>
        {t('coop.loadout.change')}
      </Button>
    </div>
  );
}

function SlotCard({ index, player, isMe, isHost, latency, stale }: { index: number; player: LobbyPlayer | undefined; isMe: boolean; isHost: boolean; latency: number; stale: boolean }): JSX.Element {
  if (!player) {
    return (
      <article class="ms-co-slot ms-plate is-empty" style={`--i:${index}`}>
        <span class="ms-co-no ms-plate ms-num">{index + 1}</span>
        <span class="ms-co-socket" aria-hidden="true">
          <EmptySeat size="6.2rem" />
        </span>
        <b class="ms-head ms-co-empty-title">{t('coop.slot.empty')}</b>
        <span class="ms-co-empty-hint">{t('coop.slot.invite')}</span>
      </article>
    );
  }
  const l = player.loadout;
  const art = l ? portraitUrl(l.classId, l.sex) : null;
  const tip = l
    ? tipProps(() => (
        <TipBody
          title={player.name}
          sub={className(l.classId)}
          rows={[
            { label: t('coop.loadout.doctrine'), value: doctrineName(l) },
            { label: t('coop.loadout.empire'), value: empireName(l) },
            {
              label: t('coop.loadout.armor'),
              value: t('coop.loadout.tier', { n: l.tier + 1 }),
            },
          ]}
        />
      ))
    : {};
  const state = !player.connected ? 'off' : stale ? 'lost' : player.ready || isHost ? 'ready' : 'wait';
  const stateText = state === 'off' ? t('coop.disconnected') : state === 'lost' ? t('coop.linkLost') : state === 'ready' ? t('coop.ready') : t('coop.notReady');
  // the strap over a phone-landscape portrait is ~98 px wide: 'Not ready' / 'Disconnected' ran past it ('NOT REA...'), so it prints the short words there
  const strapText = layout.value.tier === 'phone-l' ? (state === 'off' ? t('coop.disconnected.short') : state === 'wait' ? t('coop.notReady.short') : stateText) : stateText;
  return (
    <article class={`ms-co-slot ms-plate is-filled is-${state} ${isMe ? 'is-me' : ''}`} style={`--i:${index}`} data-nav="" tabIndex={0} {...tip}>
      <div class="ms-co-slot-art" style={art ? `background-image:url("${art}")` : ''}>
        {!art && l && <ClassSeal classId={l.classId} size="5rem" />}
        <span class="ms-co-no ms-plate ms-num">{index + 1}</span>
        {isHost && <CrownMedal label={t('coop.slot.host')} />}
        <div class={`ms-co-flag is-${state}`}>
          <i class={`ms-ol-lamp is-${state}`} aria-hidden="true" />
          <span class="ms-co-flag-text">{strapText}</span>
          {isMe && latency > 0 && <StatWell value={Math.round(latency)} unit="ms" size="sm" class="ms-co-ping" />}
        </div>
      </div>
      <div class="ms-co-slot-body">
        <div class="ms-co-slot-name">
          <b class="ms-head">{player.name}</b>
          {isMe && (
            <OlTag tone="gold" class="ms-co-you">
              {t('common.you')}
            </OlTag>
          )}
          {l && <EmpireBanner empire={l.empire} width="2.6rem" class="ms-co-slot-flag" title={empireName(l)} />}
        </div>
        {l && (
          <>
            <div class="ms-co-slot-line">
              <ClassEmblem classId={l.classId} size="1.9rem" />
              <span class="ms-co-slot-cls">
                <span>{className(l.classId)}</span> <span class="ms-co-dim"><i class="ms-co-dot">· </i>{doctrineName(l)}</span>
              </span>
            </div>
            <div class="ms-co-slot-line ms-co-slot-line--empire">
              <EmpireBanner empire={l.empire} width="2.6rem" />
              <span class="ms-co-dim">{empireName(l)}</span>
            </div>
          </>
        )}
        {/* the state plate of the narrow row cards (the strap over the portrait is hidden there so the face stays visible) */}
        <div class={`ms-co-flag ms-co-flag--body is-${state}`}>
          <i class={`ms-ol-lamp is-${state}`} aria-hidden="true" />
          <span class="ms-co-flag-text">{stateText}</span>
        </div>
      </div>
    </article>
  );
}

/** Party summary for the dock: one octagon pip per seat, lit when the hero is ready. */
function ReadyPips({ states }: { states: ('ready' | 'wait' | 'lost' | 'off' | 'empty')[] }): JSX.Element {
  return (
    <span class="ms-co-pips" aria-hidden="true">
      {states.map((s, i) => (
        <span key={i} class={`ms-co-pip is-${s}`}>
          <em class="ms-num">{i + 1}</em>
        </span>
      ))}
    </span>
  );
}

/** Dim scrim + centred dialog over the whole window (title bar included). */
function Overlay({ children, kind }: { children: ComponentChildren; kind?: 'starting' | 'dead' | 'wait' }): JSX.Element {
  return (
    <div class={`ms-co-overlay ${kind ? `is-${kind}` : ''}`} role="alertdialog" aria-live="polite">
      <div class="ms-co-dialog">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Lobby connection

interface LobbyView {
  phase: 'connecting' | 'live' | 'reconnecting' | 'closed' | 'failed';
  players: LobbyPlayer[];
  slot: number;
  host: number;
  roomPhase: RoomPhase;
  start: { zone: string; difficulty: Difficulty } | null;
  error: { code?: CoopErrorCode; close?: number; message?: string } | null;
}

const INITIAL: LobbyView = {
  phase: 'connecting',
  players: [],
  slot: -1,
  host: -1,
  roomPhase: 'lobby',
  start: null,
  error: null,
};

/** Decoded portraits of the lobby (kept referenced so the bitmaps stay in memory): a joining hero's slot card showed black for ~1 s while its painting loaded. */
const warmPortraits: HTMLImageElement[] = [];
function warmClassPortraits(): void {
  const urls = new Set<string>();
  for (const id of CLASS_IDS) {
    for (const sex of ['m', 'f'] as const) {
      const u = portraitUrl(id, sex);
      if (u) urls.add(u);
    }
  }
  for (const u of urls) {
    if (warmPortraits.some((i) => i.src.endsWith(u))) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = u;
    warmPortraits.push(img);
    void img.decode().catch(() => undefined);
  }
}

function CoopLobby({ room, onLeave, onChangeHero, onBack }: { room: string; onLeave: () => void; onChangeHero: () => void; onBack: () => void }): JSX.Element {
  const { api, coopFactory, meta, store } = deps();
  const compact = layout.value.compact;
  const sel = store.selection.value;
  const loadout = loadoutOf(sel);
  const loadoutRef = useRef(loadout);
  loadoutRef.current = loadout;
  const [view, setView] = useState<LobbyView>(INITIAL);
  const viewRef = useRef(view);
  viewRef.current = view;
  const linkRef = useRef<CoopLink | null>(null);
  const readyRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useNow(2000);
  useEffect(warmClassPortraits, []);

  useEffect(() => {
    let link: CoopLink;
    try {
      if (coopFactory) link = coopFactory(room);
      else if (api) link = CoopTransport.forRoom(api as ApiClient, room);
      else throw new Error('offline');
    } catch (e) {
      setView({
        ...INITIAL,
        phase: 'failed',
        error: { message: e instanceof Error ? e.message : String(e) },
      });
      return undefined;
    }
    linkRef.current = link;
    readyRef.current = false;
    setView(INITIAL);
    let joined: string[] = [];
    let joinedAt = 0;
    const offs = [
      link.on('state', (s) =>
        setView((v) => {
          if (s === 'open') return { ...v, phase: 'live' };
          if (s === 'reconnecting') return { ...v, phase: 'reconnecting' };
          if (s === 'connecting') return { ...v, phase: 'connecting' };
          if (s === 'closed' && v.phase !== 'failed') return { ...v, phase: v.slot >= 0 ? 'closed' : 'failed' };
          return v;
        }),
      ),
      link.on('hello', (m) => {
        setView((v) => ({
          ...v,
          phase: 'live',
          players: m.players,
          slot: m.slot,
          host: m.host,
          roomPhase: m.phase,
          error: null,
        }));
        link.join(loadoutRef.current, readyRef.current || m.slot === m.host);
      }),
      link.on('roomState', (m) => {
        const before = viewRef.current.players;
        const fresh = m.players.filter((p) => p.slot !== link.slot && p.connected && !before.some((b) => b.slot === p.slot && b.connected)).map((p) => p.name);
        if (fresh.length > 0) {
          // joins that land while the previous join toast is still up are ONE line ("A, B joined the room"), not a second toast stacked under it
          // (on a phone the second one covered the room code row and the connection pill)
          const at = Date.now();
          joined = at - joinedAt < JOIN_TOAST_MS ? [...joined, ...fresh] : fresh;
          joinedAt = at;
          // two or more joins inside the toast window are one short count line: a list of names spanned the whole phone and hid the title bar's close plate
          pushToast(joined.length > 1 ? t('coop.joinedMany', { n: joined.length }) : t('coop.joined', { name: joined[0] ?? '' }), 'info', JOIN_TOAST_MS);
          sfx('toggleOn');
        }
        for (const b of before) {
          if (b.slot !== link.slot && b.connected && !m.players.some((p) => p.slot === b.slot && p.connected)) pushToast(t('coop.left', { name: b.name }), 'info');
        }
        setView((v) => ({
          ...v,
          players: m.players,
          host: m.host,
          slot: link.slot,
          roomPhase: m.phase,
        }));
      }),
      link.on('start', (m) =>
        setView((v) => ({
          ...v,
          start: { zone: m.zone, difficulty: m.difficulty },
        })),
      ),
      link.on('end', () => setView((v) => ({ ...v, start: null, roomPhase: 'lobby' }))),
      link.on('error', (m) => {
        if (viewRef.current.phase === 'live') pushToast(t(`coop.err.${m.code}`), 'bad');
        else setView((v) => ({ ...v, error: { code: m.code } }));
      }),
      link.on('close', (c) => setView((v) => (v.error?.code ? v : { ...v, error: { close: c.code } }))),
    ];
    link.connect().catch(() => {
      setView((v) => (v.phase === 'live' ? v : { ...v, phase: 'failed' }));
    });
    return () => {
      for (const off of offs) off();
      link.leave();
      linkRef.current = null;
    };
  }, [room, attempt, api, coopFactory]);

  const link = linkRef.current;
  const me = view.players.find((p) => p.slot === view.slot);
  const isHost = view.slot >= 0 && view.slot === view.host;
  const ready = isHost || me?.ready === true;
  const others = view.players.filter((p) => p.slot !== view.slot && p.connected);
  const waitingFor = others.filter((p) => !p.ready);

  // host: zone + difficulty chooser
  const statuses = zoneStatuses(meta.save, meta.content).filter((s) => (ZONE_IDS as readonly string[]).includes(s.zone.id));
  const firstOpen = statuses.find((s) => s.unlocked)?.zone.id ?? 'yeonmu';
  const [zone, setZone] = useState<string>(() => (statuses.find((s) => s.zone.id === sel.zone)?.unlocked ? sel.zone : firstOpen));
  const [difficulty, setDifficulty] = useState<Difficulty>(sel.difficulty);
  const zoneStatus = statuses.find((s) => s.zone.id === zone);
  const hardOpen = zoneStatus?.hardUnlocked === true;
  const diff: Difficulty = difficulty === 'hard' && !hardOpen ? 'normal' : difficulty;
  const check = meta.canStart(zone, diff);

  let startReason: string | null = null;
  if (others.length === 0) startReason = t('coop.start.needPlayers');
  else if (waitingFor.length > 0)
    startReason = t('coop.start.waitingFor', {
      names: waitingFor.map((p) => p.name).join(', '),
    });
  else if (!check.ok) startReason = t('coop.start.locked');
  const canStart = isHost && view.phase === 'live' && view.roomPhase === 'lobby' && startReason === null;

  const toggleReady = (): void => {
    if (!link || view.phase !== 'live') return;
    readyRef.current = !ready;
    sfx(readyRef.current ? 'toggleOn' : 'toggleOff');
    link.join(loadout, readyRef.current);
  };
  const start = (): void => {
    if (!link || !canStart) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 0xffffffff);
    if (link.start(zone as ZoneId, diff, seed)) sfx('confirm');
    else pushToast(t('coop.start.failed'), 'bad');
  };
  const share = (): void => {
    const text = t('coop.share.text', { room });
    if (typeof navigator.share === 'function') void navigator.share({ title: t('app.title'), text }).catch(() => undefined);
  };

  const starting = view.start !== null || view.roomPhase === 'running';
  const dead = view.phase === 'failed' || view.phase === 'closed';
  const stale = view.phase === 'reconnecting';
  const connectionLabel = view.phase === 'live' ? t('coop.state.live') : view.phase === 'reconnecting' ? t('coop.state.reconnecting') : view.phase === 'connecting' ? t('coop.state.connecting') : t('coop.state.closed');
  const startZone = view.start ? statuses.find((s) => s.zone.id === view.start?.zone)?.zone : undefined;
  const startArt = startZone ? zoneArtUrl(startZone) : null;
  // the connection plate (lamp + ping): beside LEAVE ROOM in the room tray; on a phone in landscape it moves to the dock beside the party pips, so the tray
  // is ONE row (code + copy + share) and the party cards keep the 170 px they were designed for (the second row took 47 px and the dock covered the cards)
  const pillInDock = layout.value.tier === 'phone-l';
  const connPill = (
    <div class={`ms-co-conn is-${view.phase}`} role="status" title={connectionLabel}>
      <i class="ms-ol-lamp" aria-hidden="true" />
      <span class="ms-co-conn-text">{connectionLabel}</span>
      {view.phase === 'live' && link && link.latencyMs > 0 ? <StatWell value={Math.round(link.latencyMs)} unit="ms" size="sm" class="ms-co-ping" /> : null}
    </div>
  );

  const slotPlayer = (i: (typeof SLOT_IDS)[number]): LobbyPlayer | undefined =>
    view.players.find((p) => p.slot === i) ??
    (i === view.slot && view.phase === 'live'
      ? {
          slot: i,
          name: publicProfileName(meta.save.profile),
          connected: true,
          ready: false,
          loadout,
        }
      : undefined);
  const pipStates = SLOT_IDS.map((i) => {
    const p = slotPlayer(i);
    if (!p) return 'empty' as const;
    return !p.connected ? ('off' as const) : stale ? ('lost' as const) : p.ready || i === view.host ? ('ready' as const) : ('wait' as const);
  });
  const seated = pipStates.filter((s) => s !== 'empty').length;

  return (
    <Panel variant="board" ornate class="ms-ol-win ms-ol-win--fit ms-co-win" title={t('coop.title')} titleIcon={<UiGlyph name="swords" tone="gold" flat />} onClose={onBack} closeLabel={t('common.back')}>
      <div class="ms-ol-body ms-co-body" style={leatherStyle()}>
        <OlScroll class="ms-co-sc" viewClass="ms-co-main">
          <div class="ms-co-room ms-ol-tray">
            <div class="ms-co-room-code">
              <span class="ms-ol-eyebrow">{t('coop.room')}</span>
              <RoomCode code={room} />
            </div>
            <div class="ms-co-room-mid">
              <p class="ms-co-room-hint">{t('coop.room.hint')}</p>
              <div class="ms-co-room-actions">
                <Button variant="wood" size="small" sound="click" aria-label={t('common.copy')} title={t('common.copy')} onClick={() => void copyWithToast(room)}>
                  <CopyGlyph /> <span class="ms-co-btn-t">{t('common.copy')}</span>
                </Button>
                {typeof navigator.share === 'function' && (
                  <Button variant="wood" size="small" aria-label={t('coop.share')} title={t('coop.share')} onClick={share}>
                    <ShareGlyph /> <span class="ms-co-btn-t">{t('coop.share')}</span>
                  </Button>
                )}
              </div>
            </div>
            <div class="ms-co-room-side">
              {!pillInDock && connPill}
              <Button variant="wood" size="small" class="ms-co-leave" sound="back" onClick={onLeave}>
                {t('coop.leave')}
              </Button>
            </div>
          </div>

          <div
            class={`ms-co-party ${stale ? 'is-stale' : ''}`}
            aria-label={t('coop.players', {
              n: others.length + (view.slot >= 0 ? 1 : 0),
              max: COOP_MAX_PLAYERS,
            })}
          >
            {SLOT_IDS.map((i) => (
              <SlotCard key={i} index={i} player={slotPlayer(i)} isMe={i === view.slot} isHost={i === view.host} latency={link?.latencyMs ?? 0} stale={stale} />
            ))}
          </div>

          <div class="ms-co-controls ms-ol-tray">
            <LoadoutCard onChange={onChangeHero} />
            {isHost ? (
              <div class="ms-co-pick">
                <div class="ms-co-pickhead">
                  <span class="ms-ol-eyebrow">{t('coop.start.zone')}</span>
                  <Segmented
                    options={[
                      { key: 'normal', label: t('lb.difficulty.normal') },
                      {
                        key: 'hard',
                        label: t('lb.difficulty.hard'),
                        disabled: !hardOpen,
                      },
                    ]}
                    value={diff}
                    onChange={setDifficulty}
                  />
                </div>
                <div class="ms-co-zones" role="radiogroup" aria-label={t('coop.start.zone')}>
                  {statuses.map((s) => (
                    <ZoneTab
                      key={s.zone.id}
                      zone={s.zone}
                      active={s.zone.id === zone}
                      locked={!s.unlocked}
                      short={t(`coop.zone.short.${s.zone.id}`)}
                      onPick={() => setZone(s.zone.id)}
                      tip={() =>
                        s.unlocked ? (
                          <TipBody title={zoneName(s.zone.id)} sub={tl(s.zone.subtitle)} />
                        ) : (
                          <TipBody
                            title={zoneName(s.zone.id)}
                            body={t('coop.lock.zone', {
                              zone: s.requirement ? zoneName(s.requirement.zone) : '',
                            })}
                          />
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div class="ms-co-pick ms-co-pick--guest">
                <span class="ms-ol-eyebrow">{t('coop.start.zone')}</span>
                <p class="ms-co-hostpicks">{t('coop.hostPicks')}</p>
              </div>
            )}
          </div>
        </OlScroll>

        <div class="ms-co-dock">
          <span class="ms-co-party-sum">
            <ReadyPips states={pipStates} />
            {pillInDock && connPill}
            <span class="ms-co-pipcount ms-num">{t('coop.players', { n: seated, max: COOP_MAX_PLAYERS })}</span>
          </span>
          <span class={`ms-co-note ${isHost ? (startReason ? '' : 'is-ok') : ready ? 'is-ok' : ''}`}>{isHost ? (startReason ?? t('coop.start.ready')) : ready ? t('coop.start.guestWait') : t('coop.ready.hint')}</span>
          {isHost ? (
            <Button size={compact ? 'normal' : 'big'} class="ms-co-go" disabled={!canStart} onClick={start}>
              <UiGlyph name="swords" tone="ivory" flat /> {t('coop.start.button')}
            </Button>
          ) : (
            <Button size={compact ? 'normal' : 'big'} class="ms-co-go" variant={ready ? 'wood' : 'primary'} active={ready} disabled={view.phase !== 'live'} sound="none" onClick={toggleReady}>
              <UiGlyph name={ready ? 'check' : 'shield'} tone={ready ? 'gold' : 'ivory'} flat /> {ready ? t('coop.ready.cancel') : t('coop.ready.button')}
            </Button>
          )}
        </div>

        {view.phase === 'connecting' && !dead && (
          <Overlay kind="wait">
            <StateSeal kind="wait" size="6rem" />
            <b class="ms-head ms-co-dialog-title">{t('coop.state.connecting')}</b>
            <span class="ms-ol-loader" aria-hidden="true">
              <i />
            </span>
          </Overlay>
        )}
        {dead && (
          <Overlay kind="dead">
            <StateSeal kind={view.error?.message ? 'offline' : 'error'} size="6.5rem" />
            <b class="ms-head ms-co-dialog-title">{view.phase === 'failed' ? t('coop.state.error') : t('coop.state.closed')}</b>
            <p class="ms-ol-state-text ms-co-overlay-text">{view.error?.code ? t(`coop.err.${view.error.code}`) : view.error?.message ? t('coop.state.noApi') : closeText(view.error?.close)}</p>
            <div class="ms-co-overlay-actions">
              <Button
                onClick={() => {
                  sfx('confirm');
                  setAttempt((n) => n + 1);
                }}
              >
                {t('common.retry')}
              </Button>
              <Button variant="wood" sound="back" onClick={onLeave}>
                {t('coop.leave')}
              </Button>
            </div>
          </Overlay>
        )}
        {starting && (
          <Overlay kind="starting">
            {startArt && <span class="ms-co-startart ms-plate" style={`--zone-art:url("${startArt}")`} aria-hidden="true" />}
            <b class="ms-title ms-co-starting-title">{t('coop.starting.title')}</b>
            <p class="ms-ol-state-text ms-co-overlay-text">{view.start ? t('coop.starting.text', { zone: zoneName(view.start.zone) }) : t('coop.starting.generic')}</p>
            <span class="ms-ol-loader" aria-hidden="true">
              <i />
            </span>
          </Overlay>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Entry (no room yet)

function PartyStrip(): JSX.Element {
  const l = loadoutOf(deps().store.selection.value);
  return (
    <div class="ms-co-pstrip" aria-label={t('coop.players', { n: 1, max: COOP_MAX_PLAYERS })}>
      <span class="ms-ol-eyebrow">{t('coop.partyTitle')}</span>
      <span class="ms-co-psocks">
        {SLOT_IDS.map((i) => (
          <span key={i} class={`ms-co-psock ${i === 0 ? 'is-me' : ''}`}>
            {i === 0 ? <ClassSeal classId={l.classId} sex={l.sex} size="2.9rem" /> : <EmptySeat size="2.9rem" />}
            <em class="ms-num">{i + 1}</em>
          </span>
        ))}
      </span>
      <span class="ms-co-pcount ms-num">{t('coop.players', { n: 1, max: COOP_MAX_PLAYERS })}</span>
    </div>
  );
}

function CoopEntry({ onChangeHero, onBack }: { onChangeHero: () => void; onBack: () => void }): JSX.Element {
  const { api, meta } = deps();
  const bigBtn = layout.value.compact ? 'normal' : 'big';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    kind: 'create' | 'join';
    text: string;
  } | null>(null);
  const [input, setInput] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const norm = normalizeCode(input).slice(0, ROOM_CODE_LENGTH);
  const valid = isRoomCode(norm);

  const enterRoom = async (kind: 'create' | 'join'): Promise<void> => {
    if (!api || busy || (kind === 'join' && !valid)) return;
    setBusy(true);
    setError(null);
    try {
      // A first-time joiner has no credentials yet; the transport needs them to open the room socket.
      if (!api.getCredentials()) {
        const v = validateDisplayName(publicProfileName(meta.save.profile));
        await api.register(v.ok ? v.value : undefined);
        if (!mounted.current) return;
      }
      if (kind === 'create') {
        const r = await api.createRoom();
        if (!mounted.current) return;
        sfx('unlock');
        coopRoom.value = r.room.toUpperCase();
      } else {
        sfx('confirm');
        coopRoom.value = norm;
      }
    } catch (e) {
      if (!mounted.current) return;
      const text = failureText(classifyCloudError(e));
      setError({ kind, text });
      pushToast(text, 'bad');
    }
    if (mounted.current) setBusy(false);
  };

  if (!api) {
    return (
      <Panel
        variant="board"
        ornate
        class="ms-ol-win ms-ol-win--fit ms-co-win ms-co-win--offline"
        title={t('coop.title')}
        titleIcon={<UiGlyph name="swords" tone="gold" flat />}
        onClose={onBack}
        closeLabel={t('common.back')}
      >
        <div class="ms-ol-body">
          <div class="ms-co-offline ms-ol-tray">
            <div class="ms-ol-state">
              <StateSeal kind="offline" />
              <h3 class="ms-head ms-ol-state-title">{t('coop.offline.title')}</h3>
              <p class="ms-ol-state-text">{t('coop.offline.text')}</p>
              <div class="ms-co-lampline">
                <i class="ms-ol-lamp is-off" aria-hidden="true" />
                <span>{t('coop.state.noApi')}</span>
              </div>
            </div>
          </div>
          <div class="ms-co-gatefoot">
            <Button variant="wood" size="small" sound="back" onClick={onBack}>
              <UiGlyph name="back" tone="pewter" flat /> {t('common.back')} <KeyCap class="ms-kbd-only">Esc</KeyCap>
            </Button>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel variant="board" ornate class="ms-ol-win ms-ol-win--fit ms-co-win ms-co-win--gate" title={t('coop.title')} titleIcon={<UiGlyph name="swords" tone="gold" flat />} onClose={onBack} closeLabel={t('common.back')}>
      <div class="ms-ol-body ms-co-gatebody" style={leatherStyle()}>
        <OlScroll class="ms-co-sc" viewClass="ms-co-gate">
          <div class="ms-co-gatehead">
            <span class="ms-ol-eyebrow">{t('coop.eyebrow')}</span>
          </div>
          <div class="ms-co-gategrid">
            <div class="ms-co-gatehero ms-ol-tray">
              <LoadoutCard stage onChange={onChangeHero} />
            </div>
            <div class="ms-co-gatecards">
              <div class="ms-co-card ms-ol-tray" style={{ '--i': 0 } as JSX.CSSProperties}>
                <div class="ms-co-card-main">
                  <div class="ms-co-card-head">
                    <GlyphSeal size="3.2rem">
                      <UiGlyph name="plus" tone="gold" flat />
                    </GlyphSeal>
                    <h3 class="ms-head">{t('coop.create.title')}</h3>
                  </div>
                  <p class="ms-co-card-text">{t('coop.create.text')}</p>
                  <ul class="ms-co-perks">
                    {(['1', '2', '3'] as const).map((n) => (
                      <li key={n}>
                        <UiGlyph name="check" tone="gold" flat />
                        {t(`coop.create.perk${n}`)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div class="ms-co-card-side">
                  <Button size={bigBtn} disabled={busy} class="ms-co-cardbtn" onClick={() => void enterRoom('create')}>
                    {busy ? t('coop.creating') : t('coop.create.button')}
                  </Button>
                  {error?.kind === 'create' && <span class="ms-co-warn">{error.text}</span>}
                </div>
              </div>
              <div class="ms-co-or" aria-hidden="true">
                <span>{t('coop.or')}</span>
              </div>
              <div class="ms-co-card ms-ol-tray" style={{ '--i': 1 } as JSX.CSSProperties}>
                <div class="ms-co-card-main">
                  <div class="ms-co-card-head">
                    <GlyphSeal size="3.2rem">
                      <UiGlyph name="link" tone="gold" flat />
                    </GlyphSeal>
                    <h3 class="ms-head">{t('coop.join.title')}</h3>
                  </div>
                  <p class="ms-co-card-text">{t('coop.join.text')}</p>
                  <CodeInput value={norm} onInput={setInput} onEnter={() => void enterRoom('join')} label={t('coop.join.title')} />
                  <span class="ms-co-example">
                    {t('coop.join.example', {
                      code: t('coop.join.placeholder'),
                    })}
                  </span>
                </div>
                <div class="ms-co-card-side">
                  <Button variant="wood" size={bigBtn} disabled={!valid || busy} class="ms-co-cardbtn" onClick={() => void enterRoom('join')}>
                    {t('coop.join.button')}
                  </Button>
                  {norm.length === ROOM_CODE_LENGTH && !valid && <span class="ms-co-warn">{t('coop.join.invalid')}</span>}
                  {error?.kind === 'join' && <span class="ms-co-warn">{error.text}</span>}
                  {rejoinRoom && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        sfx('confirm');
                        coopRoom.value = rejoinRoom;
                        rejoinRoom = null;
                      }}
                    >
                      <UiGlyph name="link" tone="gold" flat /> {t('coop.rejoin', { room: rejoinRoom })}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div class="ms-co-gatefoot">
            <Button variant="wood" size="small" sound="back" onClick={onBack}>
              <UiGlyph name="back" tone="pewter" flat /> {t('common.back')} <KeyCap class="ms-kbd-only">Esc</KeyCap>
            </Button>
            <PartyStrip />
          </div>
        </OlScroll>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Screen

export function CoopScreen(): JSX.Element {
  const { store } = deps();
  const scope = useScope();
  const room = coopRoom.value;
  const leave = (): void => {
    coopRoom.value = null;
  };
  const back = (): void => {
    leave();
    rejoinRoom = null;
    closeView();
  };
  useKeys((a) => {
    if (a.kind !== 'cancel') return false;
    sfx('back');
    back();
    return true;
  });
  const changeHero = (): void => {
    rejoinRoom = room;
    leave();
    store.go('heroSelect');
  };
  return (
    <div class="ms-screen ms-on-screen ms-coop-screen" ref={scope}>
      <div class="ms-backdrop ms-backdrop--art ms-backdrop--dim" />
      <EmberField count={12} />
      <div class="ms-ol-stage ms-co-stage-root" key={room ?? 'entry'}>
        {room ? (
          <CoopLobby
            room={room}
            onLeave={() => {
              sfx('back');
              pushToast(t('coop.leave.toast'), 'info');
              leave();
            }}
            onChangeHero={changeHero}
            onBack={back}
          />
        ) : (
          <CoopEntry onChangeHero={changeHero} onBack={back} />
        )}
      </div>
    </div>
  );
}
