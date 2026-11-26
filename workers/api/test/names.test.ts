import { describe, expect, it } from 'vitest';
import { checkDisplayName, defaultPlayerName } from '../src/names';

describe('name moderation', () => {
  it('lets ordinary Turkish and English names through (Scunthorpe safe)', () => {
    for (const n of ['Metin', 'Kasım', 'Çağatay', 'Amina', 'Nazim', 'Cumhur', 'Assassin', 'Dickens', 'Scunthorpe', 'Sikander', 'Ejder Avcısı', 'Mavi_Kurt', 'Ninja2000', 'Şaman-42', 'Class', 'Grape', 'Analiz', 'Titan']) {
      expect(checkDisplayName(n), n).toEqual({ ok: true });
    }
  });
  it('blocks Turkish profanity incl. diacritic, leet and spacing evasions', () => {
    for (const n of ['orospu', 'Siktir', 'S1kt1r', 's i k t i r', 'amk', 'AMK', 'siiiiktir', 'yarrak', 'Pezevenk', 'o_r_o_s_p_u', 'amınakoyim', 'ibne', 'göt', 'piç']) {
      expect(checkDisplayName(n), n).toMatchObject({ ok: false, reason: 'profanity' });
    }
  });
  it('blocks English profanity incl. evasions', () => {
    for (const n of ['fuck', 'FuCk', 'f u c k', 'sh1t', 'bitch', 'b1tch', 'cunt', 'NiGGer', 'faggot', 'Cum', 'ass', 'nazi', 'hitler', 'fuuuck', 'xxx', 'porn']) {
      expect(checkDisplayName(n), n).toMatchObject({ ok: false, reason: 'profanity' });
    }
  });
  it('blocks staff impersonation', () => {
    for (const n of ['admin', 'Admin', 'ADMIN', 'a.d.m.i.n', 'Moderator', 'system', 'Official']) {
      expect(checkDisplayName(n), n).toMatchObject({ ok: false, reason: 'reserved' });
    }
    expect(checkDisplayName('Administrator1')).toEqual({ ok: true });
  });
  it('generates a legal default name', () => {
    expect(defaultPlayerName()).toMatch(/^Kahraman\d{4}$/);
  });
});
