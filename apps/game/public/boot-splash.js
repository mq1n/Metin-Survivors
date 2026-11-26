// Drives the inline boot splash of index.html (owner: B1 boot-loading). Classic script on purpose: the CSP allows 'self' scripts, not inline
// ones. It has three jobs: (1) drop the splash on pages that never call boot() (UI gallery, render demos), (2) pick the splash's wording
// language the way engine/settings.ts does, (3) expose window.__msSplash { set, done } for app/bootProgress.ts. The gauge creeps by CSS
// until the first set(), so a cold start moves even before this file or the game chunk has arrived.
(function () {
  'use strict';
  var el = document.getElementById('boot-splash');
  if (!el) return;
  if (/(^|[?&])(ui=gallery|demo=|bench=|noui)/.test(location.search)) {
    if (el.parentNode) el.parentNode.removeChild(el);
    return;
  }
  var lang = 'en';
  try {
    var saved = JSON.parse(localStorage.getItem('ms.settings.v1') || 'null');
    if (saved && (saved.language === 'tr' || saved.language === 'en')) lang = saved.language;
    else if ((navigator.language || '').toLowerCase().indexOf('tr') === 0) lang = 'tr';
  } catch (e) {
    if ((navigator.language || '').toLowerCase().indexOf('tr') === 0) lang = 'tr';
  }
  el.setAttribute('data-lang', lang);
  var sub = el.querySelector('.bs-sub');
  if (sub) {
    sub.textContent = lang === 'tr' ? 'Metin Yağmuru' : 'Rain of Metin';
    sub.lang = lang; // the span ships lang="en" (the page is lang=tr): keep the tagline's language in step with its text
  }
  var tube = el.querySelector('.bs-tube');
  if (tube) tube.setAttribute('aria-label', lang === 'tr' ? 'Yükleme ilerlemesi' : 'Loading progress');
  var fill = el.querySelector('.bs-fill');
  var stage = document.getElementById('bs-stage');
  var pct = document.getElementById('bs-pct');
  var live = false;
  var gone = false;

  function takeOver() {
    if (live || !fill) return;
    live = true;
    // continue from wherever the CSS creep has got to, so the first real value never jumps backwards
    var track = fill.parentNode;
    var now = fill.getBoundingClientRect().width;
    var all = (track && track.getBoundingClientRect().width) || 1;
    fill.style.animation = 'none';
    fill.style.transition = 'none';
    fill.style.width = (now / all) * 100 + '%';
    void fill.offsetWidth;
    fill.style.transition = '';
  }

  window.__msSplash = {
    lang: lang,
    /** p 0..1; text = the stage caption, pctText = the percent label (both already localised by the game) */
    set: function (p, text, pctText) {
      if (gone) return;
      takeOver();
      var v = Math.max(0, Math.min(1, +p || 0));
      if (fill) fill.style.width = v * 100 + '%';
      if (tube) tube.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      if (stage && text != null) stage.textContent = text;
      if (pct && pctText != null) pct.textContent = pctText;
    },
    done: function () {
      if (gone) return;
      gone = true;
      el.classList.add('is-done');
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 450);
    },
  };
})();
