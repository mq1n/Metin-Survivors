// Gallery scenarios: Armory talents + blacksmith (owner: B12 armory-b; the Armory shell itself belongs to B11).
import { armoryAt, type Scenario } from '../scenarioKit';

export const order = 55;

export const scenarios: Scenario[] = [armoryAt('talents'), armoryAt('blacksmith')];
