import { randomInt } from './crypto';

/**
 * Display-name moderation (Turkish + English). Format rules (length 3–16, charset) live in @ms/shared
 * `validateDisplayName`; this module adds the profanity / impersonation filter.
 *
 * Matching works on a folded form: lower-case, diacritics stripped (ç→c ğ→g ı/İ→i ö→o ş→s ü→u), digit
 * look-alikes mapped to letters (0→o 1→i 3→e 4→a 5→s 7→t), repeated letters collapsed (siiiktir → siktir).
 *   • SUBSTRING terms are matched anywhere in the separator-stripped name (catches `s i k t i r`, `S1kt1r`).
 *   • TOKEN terms must equal a whole word of the name, which avoids Scunthorpe cases (Nazim, Cumhur, Assassin, Dickens).
 *   • RESERVED terms block staff impersonation.
 * Common Turkish given names (Metin, Amina, Sikander …) must stay legal, hence the conservative short-term handling.
 */
const SUBSTRING_TERMS = [
  // Turkish
  'orospu', 'orospi', 'orosbu', 'siktir', 'sikeyim', 'sikerim', 'sikik', 'sikis', 'sokayim', 'sokarim', 'amcik', 'aminakoy',
  'aminakod', 'aminagoy', 'aminoglu', 'yarrak', 'dalyarak', 'pezevenk', 'gotveren', 'gotunu', 'surtuk', 'fahise', 'kancik',
  'kahpe', 'gavat', 'ananisik', 'bacinisik', 'pickurusu',
  // English
  'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'faggot', 'whore', 'asshole', 'pussy', 'bastard', 'retard', 'cocksuck',
  'dickhead', 'wanker', 'twat', 'jackoff', 'blowjob', 'handjob', 'cumshot', 'hitler', 'rapist', 'motherfuck',
];

const TOKEN_TERMS = [
  // Turkish
  'amk', 'aq', 'sik', 'got', 'pic', 'oc', 'sg', 'ibne', 'pust', 'tasak', 'dassak', 'kaltak', 'yarak', 'amq',
  // English
  'ass', 'dick', 'cock', 'cum', 'cunt', 'cunts', 'tit', 'tits', 'anal', 'rape', 'nazi', 'nazis', 'kkk', 'fag', 'fags', 'kike', 'spic', 'chink',
  'gook', 'sex', 'porn', 'porno', 'xxx', 'penis', 'vagina', 'boob', 'boobs', 'dildo', 'slut', 'sluts', 'wtf', 'stfu',
];

const RESERVED_TERMS = ['admin', 'administrator', 'moderator', 'system', 'staff', 'support', 'official', 'gm', 'developer'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i');
}

const collapse = (text: string): string => text.replace(/(.)\1+/g, '$1');
const leet = (text: string): string => text.replace(/[013457]/g, (d) => LEET[d] ?? d);

const SUBSTRINGS = SUBSTRING_TERMS.map((t) => collapse(t));
const TOKEN_SET: Record<string, true> = {};
for (const t of TOKEN_TERMS) {
  TOKEN_SET[t.replace(/ /g, '')] = true;
  TOKEN_SET[collapse(t.replace(/ /g, ''))] = true;
}
const RESERVED_SET: Record<string, true> = {};
for (const t of RESERVED_TERMS) RESERVED_SET[t] = true;

export type NameVerdict = { ok: true } | { ok: false; reason: 'profanity' | 'reserved' };

export function checkDisplayName(name: string): NameVerdict {
  const folded = fold(name);
  const tokens = folded.split(/[ _.\-]+/).filter(Boolean).map(leet);
  const joined = collapse(tokens.join(''));

  for (const token of tokens) {
    if (RESERVED_SET[token] === true || RESERVED_SET[collapse(token)] === true) return { ok: false, reason: 'reserved' };
  }
  if (RESERVED_SET[joined] === true) return { ok: false, reason: 'reserved' };

  for (const token of tokens) {
    if (TOKEN_SET[token] === true || TOKEN_SET[collapse(token)] === true) return { ok: false, reason: 'profanity' };
  }
  if (TOKEN_SET[joined] === true) return { ok: false, reason: 'profanity' };
  for (const term of SUBSTRINGS) {
    if (joined.includes(term)) return { ok: false, reason: 'profanity' };
  }
  return { ok: true };
}

/** `Kahraman4821`-style default when the client registers without a name. */
export function defaultPlayerName(): string {
  return `Kahraman${String(1000 + randomInt(9000))}`;
}
