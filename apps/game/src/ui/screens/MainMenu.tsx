// Main menu (round 3 on kit v1): a lit key-art splash (warrior kept visible, fog / light / ember life layers), the logo
// lock-up top-left, and ONE charcoal board on the right holding the whole nav: PLAY (the single, large lacquer plate with
// gold end caps and a crest), five text-only stone plates (centred label, lifted gold-text focus state, no icon, no arrow)
// and the treasury wells. Language switch + fullscreen sit top-right as three loose stone plates. On a landscape phone the
// treasury leaves the board and docks bottom-left, so the board shortens and the warrior stays in view.
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { fmtInt, lang, setLang, t, fmtAgo } from '../../i18n/i18n';
import { texUrl } from '../assets';
import { Button } from '../components/Button';
import { Segmented } from '../components/Controls';
import { Logo } from '../components/Logo';
import { Divider, Kit, Panel } from '../components/Panel';
import { StatWell } from '../components/StatWell';
import { CurrencyIcon, UiGlyph } from '../components/StatIcon';
import { GodRays, Motes } from '../components/UiFx';
import { deps } from '../env';
import { layout } from '../layout';
import { focusFirst, useKeys, useScope } from '../nav';
import { profileLabel } from '../profileName';
import { metaSave, openView, type SubView } from '../view';
import './menu.css';

interface Entry {
  view: SubView;
  label: string;
}

/** Engraved fullscreen mark: four corner brackets (own geometry, no font glyph). */
function FullscreenMark(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" class="ms-menu-fsmark" aria-hidden="true">
      <path d="M3.5 9V4.5a1 1 0 0 1 1-1H9M15 3.5h4.5a1 1 0 0 1 1 1V9M20.5 15v4.5a1 1 0 0 1-1 1H15M9 20.5H4.5a1 1 0 0 1-1-1V15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" />
      <rect x="9.6" y="9.6" width="4.8" height="4.8" fill="currentColor" opacity=".55" />
    </svg>
  );
}

/** Treasury: profile plate, the two number wells and the cloud-save status (its own board on a landscape phone). */
function Purse({ aside }: { aside: boolean }): JSX.Element {
  const { meta } = deps();
  const save = metaSave().value;
  const cloud = meta.cloud;
  const cloudOn = cloud?.enabled === true;
  const lastSync = cloud?.state.lastSyncAt ?? 0;
  const body = (
    <>
      <div class="ms-plate ms-menu-who">
        <i class="ms-menu-orn" aria-hidden="true" />
        <UiGlyph name="person" tone="gold" size="1.3em" />
        <span class="ms-menu-name">{profileLabel(save.profile.name)}</span>
        <i class="ms-menu-orn is-r" aria-hidden="true" />
      </div>
      <div class="ms-menu-bank" role="group" aria-label={t('menu.bank')}>
        <StatWell layout="row" size="md" tone="gold" label={t('hud.yeop')} title={t('hud.yeop')} icon={<CurrencyIcon kind="yeop" />} value={fmtInt(save.bank.yeop)} class="ms-menu-purse-row" />
        <StatWell layout="row" size="md" tone="info" label={t('hud.shards')} title={t('hud.shards')} icon={<CurrencyIcon kind="shard" />} value={fmtInt(save.bank.shards)} class="ms-menu-purse-row" />
      </div>
      <div class={`ms-menu-cloud ${cloudOn ? 'is-on' : ''}`}>
        <i class="ms-menu-led" aria-hidden="true" />
        <span>{cloudOn ? `${t('menu.cloud.synced')}${lastSync > 0 ? ` · ${fmtAgo(lastSync)}` : ''}` : t('menu.cloud.off')}</span>
      </div>
    </>
  );
  return aside ? (
    <Panel variant="thinboard" class="ms-menu-purse ms-menu-purse--aside">
      {body}
    </Panel>
  ) : (
    <Panel variant="sunken" framed class="ms-menu-purse">
      {body}
    </Panel>
  );
}

export function MainMenu(): JSX.Element {
  const { store, version } = deps();
  const scope = useScope();
  const l = lang.value;
  const purseAside = layout.value.tier === 'phone-l';
  useKeys(() => false);
  // focus PLAY (data-autofocus) like the modals do, so Enter works on a fresh menu
  useEffect(() => {
    const id = requestAnimationFrame(() => focusFirst());
    return () => cancelAnimationFrame(id);
  }, []);

  const entries: Entry[] = [
    { view: 'armory', label: t('menu.armory') },
    { view: 'leaderboard', label: t('menu.leaderboard') },
    { view: 'coop', label: t('menu.coop') },
    { view: 'settings', label: t('menu.settings') },
    { view: 'credits', label: t('menu.credits') },
  ];
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const logoUrl = texUrl('ui_logo');
  const graniteUrl = texUrl('uk_main_menu_granite');
  const showVersion = !!version && version !== 'dev';

  return (
    <div class="ms-screen ms-menu" ref={scope} style={graniteUrl ? ({ '--m-granite': `url("${graniteUrl}")` } as JSX.CSSProperties) : undefined}>
      {/* the painting: sized like `cover`, focus point steered per tier, every life layer lives in art space */}
      <div class="ms-menu-art" aria-hidden="true">
        <div class="ms-menu-art-img" />
        <GodRays tone="ember" x="63.5%" y="13%" size="150%" intensity={0.5} spin={260} rays={28} seed={11} class="ms-menu-rays" />
        <i class="ms-menu-glow ms-menu-glow--metin" />
        <i class="ms-menu-glow ms-menu-glow--lantern" />
        <div class="ms-menu-fog ms-menu-fog--far" />
        <div class="ms-menu-fog ms-menu-fog--near" />
      </div>
      <div class="ms-menu-veil" aria-hidden="true" />
      <div class="ms-menu-motes" aria-hidden="true">
        <Motes preset="ember" count={44} seed={5} speed={0.8} />
        <Motes preset="gold" count={14} seed={9} intensity={0.6} />
      </div>

      <header class="ms-menu-brand">
        <div class="ms-menu-logowrap" style={logoUrl ? ({ '--logo': `url("${logoUrl}")` } as JSX.CSSProperties) : undefined}>
          <Logo class="ms-menu-logo" sub={false} />
          <i class="ms-menu-sheen" aria-hidden="true" />
        </div>
        <p class="ms-menu-tag">
          <i class="ms-menu-orn" aria-hidden="true" />
          <span>{t('app.subtitle')}</span>
          <i class="ms-menu-orn is-r" aria-hidden="true" />
        </p>
      </header>

      <div class="ms-menu-top">
        <Kit contents>
          <Segmented
            options={[
              { key: 'tr', label: 'TR' },
              { key: 'en', label: 'EN' },
            ]}
            value={l}
            onChange={setLang}
          />
          {canFullscreen && (
            <Button
              variant="wood"
              size="small"
              icon
              title={t('menu.fullscreen')}
              aria-label={t('menu.fullscreen')}
              onClick={() => {
                try {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void document.documentElement.requestFullscreen();
                } catch {
                  /* some browsers refuse (iOS); ignore */
                }
              }}
            >
              <FullscreenMark />
            </Button>
          )}
        </Kit>
      </div>

      <div class="ms-menu-dock">
        <Panel variant="board" ornate class="ms-menu-board">
          <nav class="ms-menu-nav" aria-label={t('app.title')}>
            <Button size="big" block autofocus class="ms-menu-play" onClick={() => store.go('heroSelect')}>
              <i class="ms-menu-gleam" aria-hidden="true" />
              <i class="ms-menu-crest" aria-hidden="true" />
              <i class="ms-menu-cap" aria-hidden="true" />
              <span class="ms-menu-playlabel">{t('menu.play')}</span>
              <i class="ms-menu-cap is-r" aria-hidden="true" />
            </Button>
            <Divider groove="plain" class="ms-menu-groove" />
            <div class="ms-menu-sub">
              {entries.map((e) => (
                <Button key={e.view} variant="wood" block class="ms-menu-entry" onClick={() => openView(e.view)}>
                  <span class="ms-menu-elabel">{e.label}</span>
                </Button>
              ))}
            </div>
          </nav>

          {!purseAside && <Purse aside={false} />}
        </Panel>
      </div>

      {purseAside && (
        <div class="ms-menu-purse-dock">
          <Purse aside />
        </div>
      )}

      <div class="ms-menu-foot">
        <span>{t('menu.disclaimer')}</span>
        {showVersion && <span class="ms-num">{t('app.version', { v: version })}</span>}
      </div>
    </div>
  );
}
