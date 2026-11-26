// Gallery scenarios of the upgrade work package group B.codex (CX-01: the Pacts page of the Codex).
// The page reads balance.pacts (resolvePacts) and the viewed class (armoryClass), so every state below is a class + a page + an entry:
//   codexPactsSkills       Pacts page, skills of the warrior, Lightning Trio selected: its chain to Dragon's Wrath and the other Body / shared skills of that pact (a run holds one doctrine); the list is cut into basic attack / skills / milestone skills
//   codexPactsSkillsYacha   the same page for the yacha (the hero rail decides the skill list; phones keep the rail on this page), Blaze Familiars (a summon) selected
//   codexPactsPassive      passives view, Dragon's Wrath selected: "Pact: awakens ..." with the warrior skills that follow its behaviours, under their doctrine (Body / Mind)
//   codexPactsPassiveNone  passives view, Leadership (the summon pact) for the warrior, who has no summon: "awakens no Warrior skill"
//   codexPactsFree         passives view, a free passive (no behaviour maps to it)
//   codexPactsPassives     passives view, the whole list (the pact passives that awaken a skill of the hero, the ones that awaken none, then the free ones)
// The shell re-seeds its state when it mounts, so the class and the page (armoryCodexSub = 'pacts') are set after that (like the other armory scenarios).
import type { ClassId } from '../../../data/schema';
import { showCodexPacts } from '../../screens/armory/Codex';
import { setArmoryClass } from '../../screens/armory/state';
import { armoryTab, openView } from '../../view';
import type { Scenario } from '../scenarioKit';

export const order = 96;

type G = Parameters<Scenario['run']>[0];

function open(g: G, classId: ClassId, mode: 'skills' | 'passives', id?: string): void {
  g.store.setScreen('menu');
  openView('armory', 'codex');
  armoryTab.value = 'codex';
  setTimeout(() => {
    setArmoryClass(classId);
    showCodexPacts({ mode, ...(id !== undefined ? { id } : {}) });
  }, 150);
}

export const scenarios: Scenario[] = [
  { id: 'codexPactsSkills', label: 'Codex · Pacts, warrior skills (Lightning Trio)', run: (g) => open(g, 'warrior', 'skills', 'lightning_trio') },
  { id: 'codexPactsSkillsYacha', label: 'Codex · Pacts, yacha skills (Blaze Familiars)', run: (g) => open(g, 'yacha', 'skills', 'blaze_familiars') },
  { id: 'codexPactsPassive', label: "Codex · Pacts, passive Dragon's Wrath (warrior)", run: (g) => open(g, 'warrior', 'passives', 'sovereign_wrath') },
  { id: 'codexPactsPassiveNone', label: 'Codex · Pacts, passive Marshal\'s Voice (warrior: no summon)', run: (g) => open(g, 'warrior', 'passives', 'marshals_voice') },
  { id: 'codexPactsFree', label: 'Codex · Pacts, a free passive', run: (g) => open(g, 'ninja', 'passives', 'magpie_gloves') },
  { id: 'codexPactsPassives', label: 'Codex · Pacts, passives list (shaman)', run: (g) => open(g, 'shaman', 'passives') },
];
