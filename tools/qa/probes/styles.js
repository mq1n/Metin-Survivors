// styles.js — stylesheet order (C0 rail): the cascade order of the injected sheets (Vite dev: one <style> per CSS
// module, in module evaluation order) plus each sheet's rule count. Two equal-specificity rules in different files
// resolve by this order, so a CSS split must keep it. Returns [{ sheet, rules }].
const count = (rules) => {
  let n = 0;
  for (const r of rules) n += r.type === CSSRule.STYLE_RULE ? 1 + (r.cssRules ? count(r.cssRules) : 0) : r.cssRules ? count(r.cssRules) : 1;
  return n;
};
return [...document.styleSheets].map((s) => {
  const node = s.ownerNode;
  const id = node && node.getAttribute ? node.getAttribute('data-vite-dev-id') || node.getAttribute('href') || 'inline' : 'inline';
  let rules = -1;
  try {
    rules = count(s.cssRules);
  } catch {
    /* cross-origin */
  }
  return { sheet: String(id).replace(/^.*\/src\//, ''), rules };
});
