// In-page runtime of the playthrough harness (tools/qa/playthrough.ts). Injected with addInitScript, plain JS on purpose (no transpile step,
// the function bodies run exactly as written). Needs nothing from /src: the QA snapshot has none. The game is reached through window.__ms
// (the App: store, session.world, loop, input, core.renderer ...), which exists in the dev server and in a VITE_QA_HOOKS=1 build only.
//
//   window.__qa.cfg      bot 'off'|'play'|'idle', god, timeScale, stuckSimS, check flags
//   window.__qa.snap()   compact state for the Node side (screen, modal, world numbers)
//   window.__qa.begin()  / .end()   per-run frame timing, sim speed, in-page detector hits
//   window.__qa.measure()  forced gc + heap + renderer.info + DOM count (read on the MENU after every run)
//   window.__qa.hits     detector hits raised in the page (nonFinite, heroStuck, simException), drained by Node
(() => {
  if (window.__qa) return;
  const now = () => performance.now();
  const qa = (window.__qa = {
    t0: now(),
    cfg: { bot: 'off', god: false, timeScale: 1, stuckSimS: 30, nearM: 15, checkEvery: 30, botEvery: 4 },
    errors: [],
    resourceErrors: [],
    rejections: [],
    csp: [],
    gl: { created: 0, lost: 0, restored: 0, auxLost: 0, creationErrors: [], events: [] },
    long: [],
    hits: [],
    rec: null,
    ticks: 0,
    botCalls: 0,
  });
  const hit = (kind, detail, extra) => {
    const ms = window.__ms;
    const w = ms && ms.session && ms.session.world;
    qa.hits.push(Object.assign({ kind, detail: String(detail).slice(0, 1400), wall: Math.round(now() - qa.t0), sim: w ? +w.time.toFixed(2) : null }, extra || {}));
  };
  qa.hit = hit;

  // ------------------------------------------------------------------------------------------ errors / rejections / csp / resources
  window.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t !== window && (t.src || t.href)) {
        qa.resourceErrors.push({ t: Math.round(now() - qa.t0), tag: t.tagName, url: String(t.src || t.href).slice(0, 300) });
        return;
      }
      qa.errors.push({ t: Math.round(now() - qa.t0), message: String(e.message || ''), src: String(e.filename || ''), line: e.lineno || 0, col: e.colno || 0, stack: String((e.error && e.error.stack) || '').slice(0, 1500) });
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    qa.rejections.push({ t: Math.round(now() - qa.t0), reason: String((r && (r.stack || r.message)) || r).slice(0, 1500) });
  });
  document.addEventListener('securitypolicyviolation', (e) => qa.csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber }));
  // Web Workers (minimap paint, terrain normals, zone map): an uncaught error inside one fires 'error' on the Worker object (Chrome then also
  // reports it on window when nobody handles it); a worker the game handles itself stays silent. Wrap the constructor so every worker error
  // (and a 'messageerror') reports into qa.errors with the worker's name.
  try {
    const OrigWorker = window.Worker;
    if (OrigWorker && !OrigWorker.__qaWrapped) {
      const Wrapped = function (url, opts) {
        const wk = new OrigWorker(url, opts);
        const name = String(url).split('/').pop();
        wk.addEventListener('error', (e) => qa.errors.push({ t: Math.round(now() - qa.t0), message: '[worker ' + name + '] ' + String((e && e.message) || 'error event (script failed to load or threw)'), src: String((e && e.filename) || url), line: (e && e.lineno) || 0, col: (e && e.colno) || 0, stack: '' }));
        wk.addEventListener('messageerror', () => qa.errors.push({ t: Math.round(now() - qa.t0), message: '[worker ' + name + '] messageerror (a message could not be deserialised)', src: String(url), line: 0, col: 0, stack: '' }));
        return wk;
      };
      Wrapped.prototype = OrigWorker.prototype;
      Wrapped.__qaWrapped = true;
      window.Worker = Wrapped;
    }
  } catch (_) {
    /* never break the page for the detector */
  }

  // ------------------------------------------------------------------------------------------------------------------------ webgl
  const origGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = origGet.call(this, type, ...rest);
    try {
      if (ctx && typeof type === 'string' && /webgl/.test(type) && !this.__qaGl) {
        this.__qaGl = true;
        qa.gl.created++;
        // only the game canvas (#game) counts: the hero-select preview and the map canvases are disposed with forceContextLoss() on purpose
        const main = this.id === 'game';
        this.addEventListener('webglcontextlost', () => {
          if (main) qa.gl.lost++;
          else qa.gl.auxLost++;
          qa.gl.events.push({ t: Math.round(now() - qa.t0), ev: 'lost', canvas: this.id || '(no id)', main });
        });
        this.addEventListener('webglcontextrestored', () => {
          if (main) qa.gl.restored++;
          qa.gl.events.push({ t: Math.round(now() - qa.t0), ev: 'restored', canvas: this.id || '(no id)', main });
        });
        this.addEventListener('webglcontextcreationerror', (e) => qa.gl.creationErrors.push(String(e.statusMessage || 'creation error')));
      }
    } catch (_) {
      /* never break the page for the detector */
    }
    return ctx;
  };

  // ------------------------------------------------------------------------------------------------------------------------ long tasks
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) qa.long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) {
    /* not supported */
  }

  // ------------------------------------------------------------------------------------------------------------------------- the bot
  // Port of apps/game/src/sim/__tests__/bot.ts: kites in circles, flees dense crowds, walks into thin ones, collects pickups, walks to
  // metins and bosses, stays inside the arena. Returns a unit move vector in world x / z.
  function botMove(w, tick) {
    const p = w.players[0];
    if (!p || !p.alive) return [0, 0];
    const e = w.enemies;
    let rx = 0, rz = 0, near = 0, nearD2 = 1e9, nearX = 0, nearZ = 0;
    for (let i = 0; i < e.count; i++) {
      const dx = p.x - e.x[i];
      const dz = p.z - e.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < 1e-6) continue;
      if ((e.flags[i] & 8) !== 0) continue;
      if (d2 < nearD2) { nearD2 = d2; nearX = -dx; nearZ = -dz; }
      if (d2 > 49) continue;
      near++;
      const d = Math.sqrt(d2);
      const k = 1 / (d2 + 0.6);
      rx += (dx / d) * k;
      rz += (dz / d) * k;
    }
    let ex = 0, ez = 0;
    const dense = near >= 14;
    if (!dense && nearD2 > 9 && nearD2 < 900) {
      const d = Math.sqrt(nearD2);
      ex = nearX / d;
      ez = nearZ / d;
    }
    let ax = 0, az = 0;
    const P = w.pickups;
    let best = 144;
    for (let i = 0; i < P.count; i++) {
      const dx = P.x[i] - p.x;
      const dz = P.z[i] - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best && P.magnet[i] === 0) {
        best = d2;
        const d = Math.sqrt(d2) || 1;
        ax = dx / d;
        az = dz / d;
      }
    }
    let mx = 0, mz = 0;
    if (w.bosses.length === 0) {
      for (const m of w.metins) {
        if (m.phase !== 1 && m.phase !== 2) continue; // MetinPhase.Alive / Awakened
        if (m.great) continue;
        const dx = m.x - p.x;
        const dz = m.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) continue;
        if (d > 3.4) { mx = dx / d; mz = dz / d; } else { mx = (-dz / d) * 0.8; mz = (dx / d) * 0.8; }
        break;
      }
    }
    if (w.bosses.length > 0) {
      const b = w.bosses[0];
      const row = b ? e.find(b.enemy) : -1;
      if (row >= 0) {
        const dx = e.x[row] - p.x;
        const dz = e.z[row] - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 9) { mx = dx / d; mz = dz / d; } else { mx = (-dz / d) * 0.9; mz = (dx / d) * 0.9; }
      }
    }
    const a = tick * 0.02;
    const rep = dense ? 3 : 0.8;
    let vx = Math.cos(a) * 0.5 + rx * rep + ax * 0.6 + mx * 2.2 + ex * 1.4;
    let vz = Math.sin(a) * 0.5 + rz * rep + az * 0.6 + mz * 2.2 + ez * 1.4;
    const r = Math.hypot(p.x, p.z);
    const limit = w.arenaRadius - 14;
    if (r > limit) {
      vx -= (p.x / r) * (r - limit) * 0.3;
      vz -= (p.z / r) * (r - limit) * 0.3;
    }
    const m = Math.hypot(vx, vz) || 1;
    return [vx / m, vz / m];
  }

  // anti-corner: a crowd can pin the bot against the arena edge (repulsion beats the edge push). When the hero covered < 2 m in 8 s of sim,
  // walk to the arena centre for 5 s. The hero-stuck DETECTOR (30 s, 0.5 m) is untouched: it still fires when the hero cannot move at all.
  const un = { hist: [], until: -1, count: 0 };
  function unstick(w, p) {
    const t = w.time;
    if (t < un.until) return true;
    if (!un.hist.length || t - un.hist[un.hist.length - 1][0] >= 0.5) un.hist.push([t, p.x, p.z]);
    while (un.hist.length > 1 && t - un.hist[0][0] > 9) un.hist.shift();
    if (un.hist.length > 4 && t - un.hist[0][0] >= 8) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const h of un.hist) { x0 = Math.min(x0, h[1]); x1 = Math.max(x1, h[1]); z0 = Math.min(z0, h[2]); z1 = Math.max(z1, h[2]); }
      if (Math.max(x1 - x0, z1 - z0) < 2) {
        un.until = t + 5;
        un.count++;
        un.hist.length = 0;
        return true;
      }
    }
    return false;
  }
  qa.unstickCount = () => un.count;
  function drive() {
    const ms = window.__ms;
    if (!ms || !ms.session) return;
    const w = ms.session.world;
    const touch = ms.input.touch;
    if (qa.cfg.bot === 'play') {
      const p0 = w.players[0];
      if (p0 && p0.alive && unstick(w, p0)) {
        const d = Math.hypot(p0.x, p0.z) || 1;
        touch.x = -p0.x / d;
        touch.y = -p0.z / d;
        return;
      }
      if (p0 && w.time < un.until) {
        const d = Math.hypot(p0.x, p0.z) || 1;
        touch.x = -p0.x / d;
        touch.y = -p0.z / d;
        return;
      }
      const [vx, vz] = botMove(w, w.tick);
      touch.x = vx;
      touch.y = vz;
      qa.botCalls++;
    } else if (qa.cfg.bot === 'idle') {
      touch.x = 0;
      touch.y = 0;
    }
  }

  // ----------------------------------------------------------------------------------------------- per-tick checks (non-finite, stuck)
  const stuck = { hist: [], flagged: false, conf: [], confFlagged: false, offSince: -1, offFlagged: false };
  function isBad(v) { return !(v === v) || v === Infinity || v === -Infinity; }
  function checkWorld(w) {
    const p = w.players[0];
    if (p && (isBad(p.x) || isBad(p.z) || isBad(p.hp) || isBad(p.hpMax))) hit('nonFinite', 'player 0 x=' + p.x + ' z=' + p.z + ' hp=' + p.hp + '/' + p.hpMax);
    for (let k = 1; k < w.players.length; k++) {
      const q = w.players[k];
      if (isBad(q.x) || isBad(q.z) || isBad(q.hp)) hit('nonFinite', 'player ' + k + ' x=' + q.x + ' z=' + q.z + ' hp=' + q.hp);
    }
    const e = w.enemies;
    for (let i = 0; i < e.count; i++) {
      if (isBad(e.x[i]) || isBad(e.z[i]) || isBad(e.hp[i])) {
        hit('nonFinite', 'enemy row ' + i + ' type ' + e.type[i] + ' x=' + e.x[i] + ' z=' + e.z[i] + ' hp=' + e.hp[i]);
        break;
      }
    }
    for (const m of w.metins) if (isBad(m.x) || isBad(m.z) || isBad(m.hp)) { hit('nonFinite', 'metin ' + m.id); break; }
    // hero stuck: no more than 0.5 m of movement in stuckSimS of sim time while enemies are near (only when the bot should be moving)
    if (qa.cfg.bot === 'play' || qa.cfg.stuckAlways) {
      const t = w.time;
      stuck.hist.push([t, p.x, p.z]);
      while (stuck.hist.length > 1 && t - stuck.hist[0][0] > qa.cfg.stuckSimS + 1.5) stuck.hist.shift();
      if (stuck.hist.length > 2 && t - stuck.hist[0][0] >= qa.cfg.stuckSimS) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const h of stuck.hist) { x0 = Math.min(x0, h[1]); x1 = Math.max(x1, h[1]); z0 = Math.min(z0, h[2]); z1 = Math.max(z1, h[2]); }
        const ext = Math.max(x1 - x0, z1 - z0);
        let nearN = 0;
        const r2 = qa.cfg.nearM * qa.cfg.nearM;
        for (let i = 0; i < e.count; i++) {
          const dx = e.x[i] - p.x;
          const dz = e.z[i] - p.z;
          if (dx * dx + dz * dz < r2) nearN++;
        }
        // (the old rule also required an enemy within nearM: a hero held by terrain where no enemy can reach - deep inside a blocked
        // area, the case that matters most - was never reported. The crowd count stays in the message.)
        if (ext < 0.5) {
          let why = '';
          if (!stuck.flagged) {
            // what holds the hero: terrain probe (walkable ring at 1.2 / 3 / 6 m), a moveCircle step in the commanded direction, knockback
            try {
              const probe = [];
              for (const rr of [1.2, 3, 6]) {
                let ok = 0;
                for (let k = 0; k < 16; k++) if (w.env.walkable && w.env.walkable(p.x + Math.cos((k * Math.PI) / 8) * rr, p.z + Math.sin((k * Math.PI) / 8) * rr)) ok++;
                probe.push(ok + '/16@' + rr + 'm');
              }
              const tx = window.__ms.input.touch.x || 0;
              const tz = window.__ms.input.touch.y || 0;
              const out = { x: p.x, z: p.z };
              const free = w.env.moveCircle ? w.env.moveCircle(p.x, p.z, p.x + tx * 0.5, p.z + tz * 0.5, p.radius, out) : null;
              why = '; seed ' + w.config.seed + ', walkable ' + probe.join(' ') + ', moveCircle toward the command free=' + free + ' moved ' + Math.hypot(out.x - p.x, out.z - p.z).toFixed(2) + ' m, kv (' + (+p.kvx).toFixed(2) + ',' + (+p.kvz).toFixed(2) + '), enemies within 2 m: ' + (() => { let c = 0; for (let i = 0; i < e.count; i++) { const dx = e.x[i] - p.x, dz = e.z[i] - p.z; if (dx * dx + dz * dz < 4) c++; } return c; })();
            } catch (err) {
              why = '; probe failed: ' + err;
            }
          }
          if (!stuck.flagged) hit('heroStuck', (nearN === 0 ? 'NO enemy near (terrain / geometry holds the hero): ' : '') + 'moved ' + ext.toFixed(2) + ' m in ' + (t - stuck.hist[0][0]).toFixed(1) + ' s sim, ' + nearN + ' enemies within ' + qa.cfg.nearM + ' m at (' + p.x.toFixed(1) + ',' + p.z.toFixed(1) + '); commanded move (' + (window.__ms.input.touch.x || 0).toFixed(2) + ',' + (window.__ms.input.touch.y || 0).toFixed(2) + '), hero speed ' + (+p.speed).toFixed(2) + ' m/s, slowMul ' + (+p.slowMul).toFixed(2) + ', dashT ' + (+p.dashT).toFixed(2) + ', buffs ' + (p.buffs ? p.buffs.length : 0) + ', arena r ' + w.arenaRadius + ', dist from centre ' + Math.hypot(p.x, p.z).toFixed(1) + why);
          stuck.flagged = true;
        } else if (ext >= 0.5) stuck.flagged = false;
      }
      // confined: an enclosed pocket lets the hero shuffle more than 0.5 m but never out (2.5 m over 60 s of sim with no crowd to explain it)
      const conf = stuck.conf;
      conf.push([t, p.x, p.z]);
      while (conf.length > 1 && t - conf[0][0] > 61.5) conf.shift();
      if (conf.length > 2 && t - conf[0][0] >= 60) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const h of conf) { x0 = Math.min(x0, h[1]); x1 = Math.max(x1, h[1]); z0 = Math.min(z0, h[2]); z1 = Math.max(z1, h[2]); }
        const ext2 = Math.max(x1 - x0, z1 - z0);
        let crowd = 0;
        for (let i = 0; i < e.count; i++) { const dx = e.x[i] - p.x, dz = e.z[i] - p.z; if (dx * dx + dz * dz < 36) crowd++; }
        if (ext2 < 2.5 && crowd < 3 && !stuck.confFlagged) {
          stuck.confFlagged = true;
          hit('heroConfined', 'the hero stayed inside ' + ext2.toFixed(2) + ' m for ' + (t - conf[0][0]).toFixed(1) + ' s of sim with ' + crowd + ' enemies within 6 m at (' + p.x.toFixed(1) + ',' + p.z.toFixed(1) + '), seed ' + w.config.seed);
        } else if (ext2 >= 2.5) stuck.confFlagged = false;
      }
    }
    // off walkable ground: the movement code only ever steps onto walkable points, so a hero standing on a blocked one was put there by
    // something else (a spawn, a teleport, a pull): it can no longer walk anywhere but onto walkable ground right next to it
    if (p && p.alive && w.env && typeof w.env.walkable === 'function') {
      if (!w.env.walkable(p.x, p.z)) {
        stuck.offSince = stuck.offSince < 0 ? w.time : stuck.offSince;
        if (w.time - stuck.offSince >= 1.5 && !stuck.offFlagged) {
          stuck.offFlagged = true;
          hit('heroOffWalkable', 'the hero has stood on non-walkable ground for ' + (w.time - stuck.offSince).toFixed(1) + ' s of sim at (' + p.x.toFixed(2) + ',' + p.z.toFixed(2) + '), seed ' + w.config.seed + ', zone ' + w.zone.id);
        }
      } else {
        stuck.offSince = -1;
        stuck.offFlagged = false;
      }
    }
  }

  // Patch the run session's tick once per session: god mode (heal around every tick), the bot every botEvery ticks, health checks.
  function patch(ms) {
    const s = ms.session;
    if (!s || s.__qaPatched) return;
    s.__qaPatched = true;
    // a new run restarts the sim clock: the anti-corner state of the previous run (un.until is a sim time) must not carry over
    un.until = -1;
    un.hist.length = 0;
    const orig = s.tick.bind(s);
    let n = 0;
    s.tick = (dt) => {
      const w = s.world;
      const p = w.players[0];
      // god mode: full hp AND i-frames (hurtPlayer returns at once while p.iframes > 0): late-run hits are larger than the hero's max hp, healing alone does not hold
      if (qa.cfg.god && p && p.alive) {
        p.hp = p.hpMax;
        if (p.iframes < 1) p.iframes = 1;
      }
      // deliberate defeat: the hero is held at 1 hp (no god), so the first hit that lands kills it through the normal death path
      if (qa.cfg.handicap && p && p.alive && p.hp > 1) p.hp = 1;
      if (qa.cfg.bot !== 'off' && n % qa.cfg.botEvery === 0) drive();
      try {
        orig(dt);
      } catch (err) {
        hit('simException', (err && err.stack) || err);
        throw err;
      }
      if (qa.cfg.god && p && p.alive) p.hp = p.hpMax;
      qa.ticks++;
      if (++n % qa.cfg.checkEvery === 0) {
        try { checkWorld(w); } catch (err) { hit('harness', 'checkWorld threw: ' + err); }
      }
    };
    stuck.hist.length = 0;
    stuck.flagged = false;
    stuck.conf.length = 0;
    stuck.confFlagged = false;
    stuck.offSince = -1;
    stuck.offFlagged = false;
  }

  // ----------------------------------------------------------------------------------------------------------- frame recorder + bot
  let last = now();
  let lastSim = -1;
  qa.raf = 0;
  function frame(t) {
    const dt = t - last;
    last = t;
    // frames the page actually drew: the clock watcher tells a frozen sim (frames go on, the clock does not) from a page that draws no
    // frame at all for seconds (a GPU / compositor stall, e.g. first-use shader compiles: no rAF callback while JS sits idle)
    qa.raf++;
    if (qa.noRec) return requestAnimationFrame(frame); // a screenshot of the harness stalls the page: those frames are not the game's
    if (qa.raw) qa.raw.dt.push(dt);
    const ms = window.__ms;
    if (ms) {
      try {
        patch(ms);
        if (qa.cfg.bot !== 'off') drive();
        const r = qa.rec;
        if (r) {
          const st = ms.loop.stats;
          const modalOrPaused = ms.loop.paused || !!ms.store.modal.value || ms.store.screen.value !== 'run';
          r.dt.push(dt);
          if (dt > 700 && r.stalls.length < 24) {
            const wq = ms.session && ms.session.world;
            r.stalls.push({ atWallS: +((t - r.t0) / 1000).toFixed(1), ms: Math.round(dt), screen: ms.store.screen.value, modal: (ms.store.modal.value && ms.store.modal.value.kind) || null, sim: wq ? +wq.time.toFixed(1) : null, hidden: document.hidden });
          }
          r.step.push(st.stepMs);
          r.render.push(st.renderMs);
          r.steps.push(st.stepsLastFrame);
          if (!modalOrPaused) {
            r.wallActive += dt / 1000;
            const w = ms.session && ms.session.world;
            if (w && lastSim >= 0 && w.time >= lastSim) r.simActive += w.time - lastSim;
          }
          r.dropped = st.droppedSteps;
          const w2 = ms.session && ms.session.world;
          lastSim = w2 ? w2.time : -1;
          // renderer.info.render accumulates (autoReset = false, reset once per game frame) over the warm-up passes of the loading screen: 868 / 876 'draw calls'
          
          if (ms.store.screen.value === 'run') {
            const calls = ms.core.renderer.info.render.calls;
            if (calls > r.maxCalls) r.maxCalls = calls;
            const tri = ms.core.renderer.info.render.triangles;
            if (tri > r.maxTris) r.maxTris = tri;
          }
          if (w2) {
            if (w2.enemies.count > r.maxEnemies) r.maxEnemies = w2.enemies.count;
            if (w2.projectiles && w2.projectiles.count > r.maxProj) r.maxProj = w2.projectiles.count;
          }
        }
      } catch (err) {
        hit('harness', 'frame hook threw: ' + err);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const maxOf = (arr) => { let m = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; };
  const pct = (arr, q) => {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))];
  };
  qa.begin = () => {
    qa.rec = { t0: now(), stalls: [], dt: [], step: [], render: [], steps: [], wallActive: 0, simActive: 0, dropped: 0, maxCalls: 0, maxTris: 0, maxEnemies: 0, maxProj: 0, long0: qa.long.length, ticks0: qa.ticks };
    lastSim = -1;
    return true;
  };
  // frame timing without the game hook (plain production build): every rAF delta of the page
  qa.beginRaw = () => {
    qa.raw = { t0: now(), dt: [], long0: qa.long.length };
    return true;
  };
  qa.endRaw = () => {
    const r = qa.raw;
    qa.raw = null;
    if (!r) return null;
    const long = qa.long.slice(r.long0);
    return {
      wallS: +((now() - r.t0) / 1000).toFixed(1),
      frames: r.dt.length,
      frameMs: { p50: +pct(r.dt, 0.5).toFixed(2), p95: +pct(r.dt, 0.95).toFixed(2), p99: +pct(r.dt, 0.99).toFixed(2), max: +maxOf(r.dt).toFixed(1) },
      longTasks: { count: long.length, totalMs: long.reduce((s, v) => s + v[1], 0), maxMs: long.reduce((m, v) => Math.max(m, v[1]), 0), over200: long.filter((v) => v[1] > 200).length, over500: long.filter((v) => v[1] > 500).length },
    };
  };
  qa.end = () => {
    const r = qa.rec;
    qa.rec = null;
    if (!r) return null;
    const ms = window.__ms;
    const wall = (now() - r.t0) / 1000;
    const long = qa.long.slice(r.long0);
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    return {
      wallS: +wall.toFixed(1),
      frames: r.dt.length,
      frameMs: { p50: +pct(r.dt, 0.5).toFixed(2), p95: +pct(r.dt, 0.95).toFixed(2), p99: +pct(r.dt, 0.99).toFixed(2), max: +maxOf(r.dt).toFixed(1), mean: +mean(r.dt).toFixed(2) },
      stepMsPerFrame: { p50: +pct(r.step, 0.5).toFixed(2), p95: +pct(r.step, 0.95).toFixed(2), p99: +pct(r.step, 0.99).toFixed(2) },
      renderMsPerFrame: { p50: +pct(r.render, 0.5).toFixed(2), p95: +pct(r.render, 0.95).toFixed(2), p99: +pct(r.render, 0.99).toFixed(2) },
      stepsPerFrame: { mean: +mean(r.steps).toFixed(2), max: maxOf(r.steps) },
      droppedSteps: r.dropped,
      simSpeed: { active: r.wallActive > 0 ? +(r.simActive / r.wallActive).toFixed(2) : 0, simActiveS: +r.simActive.toFixed(1), wallActiveS: +r.wallActive.toFixed(1), requested: ms ? ms.loop.timeScale : 1 },
      longTasks: { count: long.length, totalMs: long.reduce((s, v) => s + v[1], 0), maxMs: long.reduce((m, v) => Math.max(m, v[1]), 0), over200: long.filter((v) => v[1] > 200).length, over500: long.filter((v) => v[1] > 500).length },
      peak: { drawCalls: r.maxCalls, triangles: r.maxTris, enemyRows: r.maxEnemies, projectiles: r.maxProj },
      ticks: qa.ticks - r.ticks0,
      unstickEvents: un.count,
      stalls: r.stalls,
    };
  };

  // ---------------------------------------------------------------------------------------------------------------- state snapshot
  qa.snap = () => {
    const ms = window.__ms;
    const base = { hook: !!ms, wall: Math.round(now() - qa.t0), url: location.pathname + location.search, raf: qa.raf };
    if (!ms) return base;
    const st = ms.store;
    const modal = st.modal.value;
    const s = ms.session;
    const w = s && s.world;
    const p = w && w.players[0];
    const boss = w && w.bosses[0];
    const bossRow = boss && w.enemies.find(boss.enemy);
    return Object.assign(base, {
      screen: st.screen.value,
      paused: st.paused.value,
      loopPaused: ms.loop.paused,
      loopRunning: ms.loop.isRunning,
      timeScale: ms.loop.timeScale,
      loading: st.loading.value,
      modal: modal ? { kind: modal.kind, id: modal.request ? modal.request.id : modal.story ? modal.story.kind + ':' + modal.story.ref : 0, cards: modal.request ? modal.request.cards.length : 0, story: modal.story ? modal.story.kind : undefined } : null,
      sel: st.selection.value,
      hasResult: !!st.result.value,
      w: w
        ? {
            time: +w.time.toFixed(2),
            tick: w.tick,
            over: w.over,
            victory: w.victory,
            endTimer: w.endTimer,
            zone: w.zone.id,
            finalAt: w.zone.final.at,
            difficulty: w.config.difficulty,
            classId: w.config.classId,
            doctrine: w.config.doctrine,
            level: p ? p.level : 0,
            hp: p ? Math.round(p.hp) : 0,
            hpMax: p ? Math.round(p.hpMax) : 0,
            alive: p ? p.alive : false,
            kills: p ? p.kills : 0,
            x: p ? +p.x.toFixed(1) : 0,
            z: p ? +p.z.toFixed(1) : 0,
            enemyRows: w.enemies.count,
            aliveEnemies: w.spawner ? w.spawner.alive : 0,
            bosses: w.bosses.length,
            bossId: boss ? boss.def.id : '',
            bossFinal: boss ? !!boss.final : false,
            bossHp: bossRow >= 0 && bossRow !== undefined ? Math.round(w.enemies.hp[bossRow]) : 0,
            metins: w.metins.length,
            pickups: w.pickups.count,
            worldModal: w.modal ? w.modal.kind : null,
            modals: w.modals.length,
          }
        : null,
      info: { calls: ms.core.renderer.info.render.calls, tris: ms.core.renderer.info.render.triangles },
      drained: { errors: qa.errors.length, rej: qa.rejections.length, glLost: qa.gl.lost },
    });
  };
  qa.drain = () => {
    const out = { hits: qa.hits.splice(0), errors: qa.errors.splice(0), resourceErrors: qa.resourceErrors.splice(0), rejections: qa.rejections.splice(0), csp: qa.csp.splice(0), gl: JSON.parse(JSON.stringify(qa.gl)) };
    qa.gl.events.length = 0;
    return out;
  };

  // --------------------------------------------------------------------------------------------------- memory on the menu (leak input)
  qa.measure = async () => {
    const gc = typeof window.gc === 'function' ? window.gc : null;
    for (let i = 0; i < 3; i++) {
      if (gc) gc();
      await new Promise((r) => setTimeout(r, 60));
    }
    const ms = window.__ms;
    const info = ms ? ms.core.renderer.info : null;
    const mem = performance.memory;
    return {
      gc: !!gc,
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : -1,
      heapTotalMB: mem ? +(mem.totalJSHeapSize / 1048576).toFixed(1) : -1,
      geometries: info ? info.memory.geometries : -1,
      textures: info ? info.memory.textures : -1,
      programs: info && info.programs ? info.programs.length : -1,
      dom: document.getElementsByTagName('*').length,
      canvases: document.getElementsByTagName('canvas').length,
    };
  };
})();
