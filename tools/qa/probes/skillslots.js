// Skill slots of the run UI (QA PLAYREV-2): gives the hero the basic attack + 6 actives (+ N ultimates, window.__probeOpts.ultimates, default 1)
// in the gallery and checks that the taskbar, the pause panel and the level-up board list every skill, and that the counts read 6/6 (never 7/6).
// Gallery only (`/?ui=gallery`, `bun tools/qa/shot.ts ui --screens hud --eval @tools/qa/probes/skillslots.js`). Returns { pass, checks, ... }.
const ui = window.__ui;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nUlt = (window.__probeOpts && window.__probeOpts.ultimates) ?? 1;
const classId = ui.classId;
const skills = ui.content.skills;
const basic = skills.find((s) => s.classId === classId && s.kind === 'basic');
const actives = skills.filter((s) => (s.classId === classId || s.classId === 'common') && s.kind === 'active').slice(0, 6);
const ultimates = skills.filter((s) => s.kind === 'ultimate').slice(0, nUlt);
const slotOf = (d, isBasic) => ({ id: d.id, icon: d.icon, rank: 3, cooldown: 0, cdLeft: 0, basic: isBasic, awakened: false });
const held = [slotOf(basic, true), ...ultimates.map((d) => slotOf(d, false)), ...actives.map((d) => slotOf(d, false))];
const give = () => {
  const h = ui.store.hud.value;
  ui.store.setHud({ ...h, skills: held });
};
const icons = (root) => [...root.querySelectorAll('.ms-slot')].filter((e) => !e.classList.contains('is-ghost') && e.querySelector('img, svg, canvas, .ms-slot-art')).length;
const out = { held: held.length, expectHeld: 1 + 6 + ultimates.length, checks: {} };

// taskbar
ui.apply('hud');
await wait(900);
give();
await wait(500);
{
  const tb = document.querySelector('.ms-tb-skills');
  const slots = tb ? tb.querySelectorAll('.ms-tb-sk').length : -1;
  const dimples = tb ? tb.querySelectorAll('.ms-tb-dimple').length : -1;
  out.taskbar = { slots, dimples, ids: tb ? [...tb.querySelectorAll('.ms-tb-sk')].length : 0, rect: tb ? Math.round(tb.getBoundingClientRect().width) : 0, vw: innerWidth };
  out.checks.taskbarListsAll = slots === out.expectHeld && dimples === 0;
}

// pause
ui.apply('pause');
await wait(900);
give();
await wait(600);
{
  const rows = [...document.querySelectorAll('.ms-pause-row')];
  const row = rows[0];
  const count = row ? (row.querySelector('.ms-pause-count')?.textContent ?? '').replace(/\s+/g, '') : '';
  const slotEls = row ? [...row.querySelectorAll('.ms-pause-slots .ms-slot')] : [];
  const tray = row ? row.querySelector('.ms-pause-slots') : null;
  const last = slotEls[slotEls.length - 1];
  const cardR = tray ? tray.closest('.ms-pause-card')?.getBoundingClientRect() : null;
  const lastR = last ? last.getBoundingClientRect() : null;
  out.pause = { count, slots: slotEls.length, slotPx: slotEls[0] ? Math.round(slotEls[0].getBoundingClientRect().width) : 0, lastRight: lastR ? Math.round(lastR.right) : 0, cardRight: cardR ? Math.round(cardR.right) : 0 };
  out.checks.pauseCountIsActives = count === '6/6';
  out.checks.pauseListsAll = slotEls.length === out.expectHeld;
  out.checks.pauseInsideCard = !!(lastR && cardR && lastR.right <= cardR.right + 1);
}

// level-up board
ui.apply('levelUp');
await wait(1200);
give();
await wait(600);
{
  const row = document.querySelector('.ms-lu-row');
  const slotEls = row ? [...row.querySelectorAll('.ms-slot')] : [];
  out.levelUp = { slots: slotEls.length, rowWidth: row ? Math.round(row.getBoundingClientRect().width) : 0 };
  out.checks.levelUpListsAll = slotEls.length === out.expectHeld;
}
out.pass = Object.values(out.checks).every(Boolean);
return out;
