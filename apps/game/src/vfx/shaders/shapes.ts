// Parametric shape batch: arcs / rings / cones / disks (mode 0), vertical cylinders (1), camera-facing beams (2),
// ground lanes (3). One instanced grid mesh serves them all; the fragment shader selects a procedural pattern.
import { HERO_GUARD_GLSL } from '../heroGuard';
import { GLSL_ATLAS, GLSL_COMMON } from './common';

export const SHAPE_VERT = /* glsl */ `
${GLSL_COMMON}
uniform float uTime;
attribute vec4 sA; // center.xyz, birth
attribute vec4 sB; // yaw, pitch, roll, life
attribute vec4 sC; // mode, pattern, seed, fadeCode
attribute vec4 sD; // r0, r1, span, a0
attribute vec4 sE; // sweep, trail, expand0, aux (crescent | cylinder height)
attribute vec4 sF; // slopeX, slopeZ, killTime, omega
attribute vec4 sG; // intensity, thickShrink, lift, param
attribute vec4 sCol0;
attribute vec4 sCol1;

varying vec4 vP;   // gu, gv, prog, ge
varying vec4 vA;   // seed, pattern, mode, ang
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vE;
varying vec4 vM;   // time since birth, rOut(m), thickness(m), param
varying vec3 vL;   // local position (m)
varying vec3 vWp;  // world position
varying vec3 vNrm; // world normal (cylinder)

void main(){
  float t = uTime - sA.w;
  float life = sB.w;
  float u = t / life;
  float kf = 1.0;
  if (uTime > sF.z) kf = 1.0 - clamp((uTime - sF.z) / 0.3, 0.0, 1.0);
  if (t < 0.0 || u >= 1.0 || kf <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vP = vec4(0.0); vA = vec4(0.0); vC0 = vec4(0.0); vC1 = vec4(0.0); vE = vec4(0.0); vM = vec4(0.0);
    vL = vec3(0.0); vWp = vec3(0.0); vNrm = vec3(0.0, 1.0, 0.0);
    return;
  }
  int mode = int(sC.x + 0.5);
  int fcode = int(sC.w + 0.5);
  float gu = position.x;
  float gv = position.y;
  float ge = mix(sE.z, 1.0, easeOut3(clamp(u, 0.0, 1.0)));

  vec3 local;
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float ang = 0.0;
  float rOut = sD.y * ge;
  float thick = (sD.y - sD.x) * ge * (1.0 - sG.y * u);
  float H = sE.w;

  if (mode == 0) {
    ang = sD.w + sF.w * t + sD.z * gu;
    float prof = mix(1.0, pw(max(sin(PI * gu), 0.0), 0.75), sE.w);
    float rIn = rOut - thick * prof;
    float r = mix(rIn, rOut, gv);
    local = vec3(sin(ang), 0.0, cos(ang)) * r;
  } else if (mode == 1) {
    ang = sD.w + sF.w * t + sD.z * gu;
    float rad = mix(sD.x, sD.y, gv) * ge;
    local = vec3(sin(ang) * rad, gv * H, cos(ang) * rad);
    nrm = vec3(sin(ang), 0.0, cos(ang));
  } else if (mode == 3) {
    local = vec3((gv - 0.5) * sD.x, 0.0, gu * sD.y);
  } else if (mode == 4) {
    // vertical plane facing along yaw: gu across (width sD.x, grows with the expand curve), gv up (height H), narrower at the top
    local = vec3((gu - 0.5) * sD.x * ge * mix(1.0, 0.62, gv * gv), gv * H, 0.0);
    nrm = vec3(0.0, 0.0, 1.0);
  } else {
    local = vec3(0.0);
  }

  mat3 R = rotY(sB.x) * rotX(sB.y) * rotZ(sB.z);
  vec3 wpos;
  if (mode == 2) {
    vec3 dir = R * vec3(0.0, 0.0, 1.0);
    float len = sD.y * mix(sE.z, 1.0, easeOut2(clamp(u * 6.0, 0.0, 1.0)));
    vec3 pc = sA.xyz + dir * len * gu;
    vec3 side = cross(dir, pc - cameraPosition);
    float sl = length(side);
    side = sl > 0.0001 ? side / sl : vec3(1.0, 0.0, 0.0);
    float wprof = smoothstep(0.0, 0.05, gu) * (1.0 - smoothstep(0.93, 1.0, gu));
    wpos = pc + side * (gv - 0.5) * sD.x * mix(0.35, 1.0, wprof);
    local = vec3((gv - 0.5) * sD.x, 0.0, gu * len);
    nrm = side;
  } else {
    wpos = sA.xyz + R * local;
    nrm = R * nrm;
    if (mode == 0 || mode == 3) wpos.y += sF.x * (wpos.x - sA.x) + sF.y * (wpos.z - sA.z) + sG.z;
  }

  if (mode != 2) {
    // slide the surface toward the camera along its own view ray: identical screen position, but terrain bumps and the
    // flat slope-plane approximation can no longer slice wedges out of ground effects
    float bias = (mode == 1 || mode == 4) ? 0.15 : min(0.22 + 0.08 * rOut, 1.0);
    vec3 toC = cameraPosition - wpos;
    float dC = max(length(toC), 0.001);
    wpos += toC * (min(bias, dC * 0.4) / dC);
  }
  float env = smoothstep(0.0, 0.025, u) * fadeOutCurve(fcode, u) * kf;
  vP = vec4(gu, gv, u, ge);
  vA = vec4(sC.z, sC.y, sC.x, ang);
  vC0 = vec4(srgb2lin(sCol0.rgb) * sG.x, sCol0.a * env);
  vC1 = vec4(srgb2lin(sCol1.rgb) * sG.x, sCol1.a * env);
  vE = sE;
  vM = vec4(t, rOut, thick, sG.w);
  vL = local;
  vWp = wpos;
  vNrm = nrm;
  gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
}
`;

export const SHAPE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_ATLAS}
${HERO_GUARD_GLSL}
uniform sampler2D uNoise;
uniform sampler2D uAtlas;
varying vec4 vP;
varying vec4 vA;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vE;
varying vec4 vM;
varying vec3 vL;
varying vec3 vWp;
varying vec3 vNrm;

// domain warp so the 256px tileable noise never shows its repeat inside one decal
vec2 wrp(vec2 p, float k){ return p + (texture2D(uNoise, p * 0.31 + vec2(0.37, 0.71)).rg - 0.5) * k; }
float tnz(vec2 uv, int ch){ vec4 n = texture2D(uNoise, uv); return ch == 0 ? n.r : ch == 1 ? n.g : ch == 2 ? n.b : n.a; }

// Voronoi borders: x = distance to the nearest feature point, y = F2 - F1 (0 on a cell border): crack networks that join up
vec2 vorEdge(vec2 p, float sd){
  vec2 ip = floor(p);
  vec2 fp = p - ip;
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = ip + g;
      vec2 o = vec2(hash21(id + sd), hash21(id + sd + 41.7));
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}

// regular polygon outline distance helper (unit circumradius ~ R)
float polyD(vec2 p, float n, float R){
  float a = atan(p.x, p.y) + PI;
  float s = TAU / n;
  return abs(cos(floor(0.5 + a / s) * s - a) * length(p) - R * cos(PI / n));
}

// telegraph marks (patterns 12–14). SDF furniture ported from threejs-vfx src/effects/ZoneIndicator.js + src/effects/AimIndicator.js
// (MIT, © mohamedachrefelouafi — see ../elemental/LICENSE): every mark is measured in metres, so the boundary band, liner, ticks and
// chevrons keep their physical size whether the footprint is 2 m or 10 m across.
float teleBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// iq's exact triangle SDF (negative inside): the arrow head is a wide shallow wedge where half-plane tricks leave corner artefacts
float teleTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(max(d.x, 0.0)) * sign(d.y);
}
// anti-aliased line of half-width w (metres) around x = 0
float teleLine(float x, float w){ float aa = fwidth(x) + 0.006; return 1.0 - smoothstep(w, w + aa, abs(x)); }

void main(){
  float gu = vP.x, gv = vP.y, prog = vP.z;
  float t = vM.x;
  float seed = vA.x;
  int pat = int(vA.y + 0.5);
  float ang = vA.w;
  vec3 c0 = vC0.rgb;
  vec3 c1 = vC1.rgb;
  float env = vC0.a;
  float env1 = vC1.a;
  vec3 col = c0;
  vec3 addc = vec3(0.0);
  float a = 0.0;

  if (pat == 0) { // slash crescent
    float sw = vE.x;
    float tr = vE.y;
    float head = 1.0;
    float tail = 0.0;
    if (sw > 0.0) {
      head = easeOut3(clamp(prog / sw, 0.0, 1.0));
      float tl = easeIn2(clamp((prog - sw * 0.35) / (1.0 - sw * 0.35), 0.0, 1.0));
      tail = max(tl, head - tr);
    }
    float span = max(head - tail, 0.001);
    float w = clamp((gu - tail) / span, 0.0, 1.0);
    float lead = 1.0 - smoothstep(head - 0.006, head + 0.012, gu);
    float rear = smoothstep(tail, tail + span * 0.6, gu);
    float edge = smoothstep(0.0, 0.9, gv);
    float outerCut = 1.0 - smoothstep(0.975, 1.0, gv);
    float body = pw(edge, 1.5) * outerCut;
    float rim = smoothstep(0.80, 0.96, gv) * outerCut;
    float n1 = tnz(vec2(gu * 2.2 + seed, gv * 1.1 + seed * 3.0), 0);
    float n2 = tnz(vec2(gu * 5.0 - prog * 0.9, gv * 2.6 + seed), 1);
    float nn = n1 * 0.7 + n2 * 0.3;
    float thr = smoothstep(sw * 0.5, 1.0, prog) * 1.1;
    float er = smoothstep(thr, thr + 0.18, nn + 0.12);
    float ed = smoothstep(thr - 0.02, thr + 0.05, nn + 0.12) * (1.0 - smoothstep(thr + 0.05, thr + 0.2, nn + 0.12));
    a = lead * rear * body * er;
    float hot = pw(w, 2.5);
    col = mix(c1, c0, hot);
    addc = (vec3(1.0) * rim * hot * 0.9 + c0 * ed * 0.8) * lead * rear * outerCut;
    a *= 1.0 - smoothstep(0.8, 1.0, prog);
    addc *= 1.0 - smoothstep(0.8, 1.0, prog);
  } else if (pat == 1) { // shock ring: bright outer lip, soft trailing body
    float n = tnz(vec2(ang * 0.32 + seed, prog * 0.6), 0);
    float front = pw(gv, 5.0);
    float body = pw(gv, 1.7) * 0.32;
    a = (front + body) * (0.7 + 0.6 * n);
    col = mix(c1, c0, front);
    addc = vec3(1.0) * pw(gv, 14.0) * 0.5;
    a *= 1.0 - smoothstep(0.0, 0.08, 1.0 - gv) * 0.0;
  } else if (pat == 2) { // soft symmetric band (auras, buff rings)
    float s = 1.0 - abs(2.0 * gv - 1.0);
    float n = tnz(vec2(ang * 0.8 + t * 0.7, gv * 2.0 + seed), 0);
    a = pw(s, 1.6) * (0.55 + 0.9 * n);
    col = mix(c1, c0, pw(s, 3.0));
  } else if (pat == 3) { // glow disk
    float n = tnz(vec2(ang * 0.3 + t * 0.25, gv * 1.5 - t * 0.2), 0);
    a = pw(max(1.0 - gv, 0.0), 1.7) * (0.65 + 0.7 * n);
    col = mix(c1, c0, pw(1.0 - gv, 2.0));
  } else if (pat == 4) { // rune circle
    float r = gv;
    vec2 pl = vec2(sin(ang), cos(ang)) * r;
    float aa = 0.0;
    aa += smoothstep(0.016, 0.0, abs(r - 0.965)) * 0.9;
    aa += smoothstep(0.012, 0.0, abs(r - 0.835)) * 0.7;
    aa += smoothstep(0.012, 0.0, abs(r - 0.60)) * 0.7;
    float bandR = (r - 0.645) / 0.17;
    float N = 10.0;
    float sa = ang / TAU * N;
    float kk = floor(sa);
    if (bandR > 0.0 && bandR < 1.0) {
      float cell = 32.0 + floor(hash11(kk + seed * 17.0) * 8.0);
      vec4 gl = texture2D(uAtlas, atlasUV(cell, vec2(fract(sa), bandR)));
      aa += gl.a * 1.1;
    }
    float tick = step(0.5, fract(ang / TAU * 48.0)) * step(0.865, r) * step(r, 0.93);
    aa += tick * 0.55;
    aa += smoothstep(0.012, 0.0, polyD(pl, 3.0, 0.56)) * 0.85;
    aa += smoothstep(0.012, 0.0, polyD(vec2(pl.x, -pl.y), 3.0, 0.56)) * 0.85;
    aa += smoothstep(0.02, 0.0, abs(r - 0.18)) * 0.8;
    float n = tnz(vec2(ang * 0.4 + seed, r * 2.0 + t * 0.15), 0);
    aa *= 0.75 + 0.5 * n;
    float pulse = 0.78 + 0.22 * sin(t * 2.6 + seed * 6.0);
    a = clamp(aa, 0.0, 1.4) * pulse * smoothstep(1.0, 0.94, r);
    col = mix(c1, c0, smoothstep(0.55, 0.95, r) * 0.7);
    addc = c0 * 0.25 * pw(max(1.0 - r, 0.0), 2.0) * pulse;
  } else if (pat == 5) { // glowing ground cracks: contour lines of a ridged fbm, hot core, fading to the rim
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.0);
    vec2 q = wrp(pl * 0.62 + seed * 7.0, 0.9);
    float ra = tnz(q, 3);
    float rb = tnz(wrp(pl * 1.35 + 4.0 + seed * 3.0, 0.7), 3);
    float lines = max(smoothstep(0.80, 0.93, ra), smoothstep(0.86, 0.95, rb) * 0.7);
    float core = max(smoothstep(0.90, 0.985, ra), smoothstep(0.93, 0.99, rb) * 0.6);
    float fall = (1.0 - smoothstep(0.30, 1.0, r)) * smoothstep(0.0, 0.1, r + 0.15);
    float cool = 1.0 - smoothstep(0.1, 0.85, prog);
    a = lines * fall * 0.95;
    col = mix(c1, c0, core * cool);
    addc = c0 * core * fall * (0.35 + 1.1 * cool);
  } else if (pat == 6) { // scorch / burn decal (alpha): soft charred patch, ember veins that cool off
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.0);
    float n = tnz(wrp(pl * 0.5 + seed, 0.8), 0);
    float n2 = tnz(wrp(pl * 1.9 + seed * 3.0, 0.5), 1);
    float edge = r + (n - 0.5) * 0.34;
    float body = pw(1.0 - smoothstep(0.18, 0.98, edge), 1.25);
    a = body * (0.5 + 0.5 * n2);
    col = mix(c1, c1 * 0.45, body);
    float vein = smoothstep(0.86, 0.96, tnz(wrp(pl * 0.9 + seed * 5.0, 0.9), 3)) * body;
    float hot = 1.0 - smoothstep(0.0, 0.55, prog);
    addc = c0 * (vein * 1.4 + smoothstep(0.55, 0.85, edge) * (1.0 - smoothstep(0.85, 1.0, edge)) * 0.6) * hot;
  } else if (pat == 7) { // liquid pool (alpha): poison / acid / water
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.0);
    float n = tnz(wrp(pl * 0.5 + seed, 0.8), 0);
    float edge = r + (n - 0.5) * 0.3;
    float body = 1.0 - smoothstep(0.7, 0.92, edge);
    float cau = tnz(wrp(pl * 1.1 + vec2(t * 0.05, -t * 0.03), 0.6), 3);
    float bub = smoothstep(0.80, 0.84, tnz(pl * 1.5 + floor(t * 1.5) * 0.37, 1)) * (1.0 - smoothstep(0.5, 0.9, r));
    float rim = smoothstep(0.62, 0.8, edge) * (1.0 - smoothstep(0.8, 0.94, edge));
    a = body * (0.55 + 0.35 * cau);
    col = mix(c1, c0, cau * 0.5);
    addc = c0 * (rim * 0.55 + bub * 0.7 + smoothstep(0.82, 0.95, cau) * 0.25) * body;
  } else if (pat == 8) { // frost patch (alpha): frosted disk, six-fold dendrites, hairline veins, glints
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.0);
    float an = atan(pl.x, pl.y);
    float n = tnz(wrp(pl * 0.5 + seed, 0.8), 0);
    float edge = r + (n - 0.5) * 0.3;
    float body = 1.0 - smoothstep(0.55, 0.98, edge);
    float sec = abs(fract(an / TAU * 6.0 + seed) - 0.5) * 2.0;
    float jag = tnz(vec2(an * 0.9 + seed, r * 3.0), 0);
    float spoke = smoothstep(0.07 + 0.35 * r * r, 0.0, sec * (0.5 + 0.7 * jag) * r) * (1.0 - smoothstep(0.55, 0.98, r));
    float vein = smoothstep(0.84, 0.95, tnz(wrp(pl * 1.3 + seed * 5.0, 0.8), 3)) * body;
    float glint = smoothstep(0.93, 0.98, tnz(pl * 3.1 + seed, 1)) * body;
    a = body * 0.30 + spoke * 0.5 + vein * 0.45;
    col = mix(c1, c0, clamp(spoke + vein + 0.2, 0.0, 1.0));
    addc = c0 * (spoke * 0.35 + vein * 0.3) + vec3(1.0) * glint * 0.7;
  } else if (pat == 9) { // flame wall / ring of fire (cylinder, gv = height)
    float nA = tnz(vec2(gu * 3.0 + seed, gv * 0.7 - t * 1.5), 0);
    float nB = tnz(vec2(gu * 6.0 - seed, gv * 1.4 - t * 2.4), 1);
    float n = nA * 0.65 + nB * 0.35;
    float h = gv;
    float shape = smoothstep(h * 1.05, h * 1.05 + 0.28, n * 1.35);
    a = shape * (1.0 - smoothstep(0.82, 1.0, h));
    col = mix(c0, c1, smoothstep(0.0, 0.8, h));
    addc = c0 * shape * (1.0 - h) * 0.5;
  } else if (pat == 10) { // light pillar (cylinder)
    vec3 V = normalize(cameraPosition - vWp);
    float fres = pw(clamp(abs(dot(normalize(vNrm), V)), 0.0, 1.0), 1.6);
    float n = tnz(vec2(gu * 5.0 + seed, gv * 0.45 - t * 0.9), 0);
    float hf = pw(1.0 - gv, 1.1) * smoothstep(0.0, 0.04, gv + 0.02);
    a = fres * hf * (0.6 + 0.8 * n);
    col = mix(c1, c0, fres * (1.0 - gv));
    addc = c0 * fres * pw(1.0 - gv, 3.0) * 0.4;
  } else if (pat == 11) { // beam
    float x = abs(2.0 * gv - 1.0);
    float len = max(vM.y, 0.01);
    float n = tnz(vec2(gu * len * 0.35 - t * 3.2 + seed, gv * 0.9), 0);
    float n2 = tnz(vec2(gu * len * 0.9 + t * 2.0, gv * 1.3 + seed), 1);
    float core = exp(-x * x * 16.0);
    float halo = exp(-x * x * 3.4);
    a = (core * 0.9 + halo * (0.35 + 0.55 * n)) * (0.82 + 0.3 * n2);
    col = mix(c1, c0, core);
    addc = vec3(1.0) * core * core * 0.7;
    a *= 1.0 - smoothstep(0.88, 1.0, prog);
  } else if (pat == 12 || pat == 13 || pat == 14) {
    // telegraph, alpha (the warning pings re-light it additively): 12 disk / cone (param = full angle), 13 annulus, 14 lane (param =
    // width). A ZoneIndicator footprint in metres: a 0.34 m boundary band with a hard liner on its inner lip, a rim-weighted wash,
    // contour rings travelling outward, ticks + radar sweep + reticle (disk, annulus) or AimIndicator chevrons + arrow head (lane,
    // cone). It snaps out from its origin in 0.3 s and lands with an overshoot pop; the timer front sits at f = prog and charges the
    // wash behind it; the last 0.16 s before resolve flash hot (standing marks only — the lifetime is recovered as t / prog).
    float life = prog > 0.001 ? t / prog : 1.0;
    float rem = max(life - t, 0.0);
    float R = max(vM.y, 0.01);
    vec2 p = vL.xz;                  // metres; +y = cone axis / lane length
    float d = length(p);
    float sd = d - R;                // signed distance to the outline (< 0 inside)
    float ext = R;                   // metres the fill travels
    float f = d / R;                 // fill coordinate: the timer front sits at f = prog
    float deep = R;                  // deepest inside distance (rim weighting)
    float an = atan(p.x, p.y) / TAU + 0.5;
    float perim = TAU * R;
    float spin = 1.0;
    float arcSide = 1.0;             // cone: 1 where the arc (not a side) is the nearest edge
    int kind = 0;                    // 0 disk, 1 cone, 2 annulus, 3 lane
    if (pat == 14) {
      kind = 3;
      float W = max(vM.w, 0.1);
      float rc = min(0.12, W * 0.2);
      sd = teleBox(p - vec2(0.0, R * 0.5), vec2(W * 0.5 - rc, R * 0.5 - rc)) - rc;
      f = p.y / R;
      deep = W * 0.5;
    } else if (pat == 13) {
      kind = 2;
      float r0 = max(R - vM.z, 0.0);
      sd = max(d - R, r0 - d);
      ext = max(R - r0, 0.01);
      f = (d - r0) / ext;
      deep = ext * 0.5;
      perim = TAU * (f < 0.5 ? r0 : R);   // ticks keep their spacing on the inner edge too
    } else if (vM.w > 0.0) {
      kind = 1;
      float h = 0.5 * vM.w;
      float th = atan(p.x, p.y);
      float q = h - abs(th);
      float sideD = q < PI * 0.5 ? d * sin(max(q, 0.0)) : d;
      arcSide = step(R - d, sideD);
      sd = max(sd, -sideD);
      float sh = sin(min(h, PI * 0.5));
      deep = R * sh / (1.0 + sh);
      an = th / vM.w + 0.5;
      perim = R * vM.w;
      spin = 0.0;
    }
    f = clamp(f, 0.0, 1.0);
    float fm = f * ext;

    // the standing mark snaps out from its origin: outCubic × the sandbox's late bump (snap 1.1) throws the front past the outline and
    // it settles back onto it. A 0.15 s ping (stand = 0) skips the snap: its own fast timer front is the radar sweep.
    float stand = smoothstep(0.3, 0.6, life);
    float sn = stand > 0.5 ? clamp(t / 0.3, 0.0, 1.0) : 1.0;
    float reach = (1.0 - pw(1.0 - sn, 3.0)) * (1.0 + 0.1 * sin(PI * pw(sn, 1.7)));
    float pop = clamp((reach - 1.0) / 0.07, 0.0, 1.0);
    float rm = reach * ext;
    float shown = sn >= 1.0 ? 1.0 : 1.0 - smoothstep(rm, rm + 0.12, fm);

    // the boundary band (brightest at its outer lip, the honest edge) with a hard liner on the inner lip
    float aa = fwidth(sd) + 0.006;
    float inside = 1.0 - smoothstep(-aa, aa, sd);
    float bw = min(0.34, deep * 0.4) * (1.0 + 0.5 * pop);
    float band = inside * smoothstep(-bw - aa, -bw + aa, sd);
    float outer = smoothstep(-bw, 0.0, sd);
    float liner = inside * teleLine(sd + bw, 0.03);
    float lip = inside * teleLine(sd + 0.04, 0.025);
    float rimW = pw(1.0 - clamp(-sd / max(deep, 0.01), 0.0, 1.0), 1.5);
    float snapB = inside * (1.0 - step(1.0, reach)) * teleLine(fm - rm, 0.12);

    vec2 np = p + vec2(seed * 13.7, seed * 7.3);
    float n = tnz(wrp(np * 0.11 + vec2(t * 0.02, -t * 0.015), 0.6), 0);
    float veins = smoothstep(0.80, 0.95, tnz(wrp(np * 0.075 + vec2(-t * 0.02, t * 0.03), 0.8), 3));

    // the timer: everything behind the front is charged
    float pm = prog * ext;
    float charged = 1.0 - smoothstep(pm - 0.04, pm + 0.04, fm);
    float front = teleLine(fm - pm, 0.05) * step(0.004, prog);
    float lead = charged * exp(-max(pm - fm, 0.0) * 1.6);

    // contour rings travelling outward, faster as the resolve nears
    float sp = clamp(ext / 3.0, 0.9, 2.2);
    float kc = fm / sp - t * (0.7 + 1.4 * prog);
    float contour = teleLine(abs(fract(kc + 0.5) - 0.5) * sp, 0.04);

    float tick = 0.0;
    float sweep = 0.0;
    float ret = 0.0;
    float chev = 0.0;
    float head = 0.0;
    if (kind != 3) {
      float N = max(12.0, floor(perim / 0.9));
      float tp = fract(an * N + t * 0.06 * spin * N);
      tick = (1.0 - smoothstep(0.09, 0.15, tp)) * smoothstep(-bw - 0.46, -bw - 0.4, sd) * (1.0 - smoothstep(-bw - 0.07, -bw - 0.03, sd))
        * mix(0.35, 1.0, smoothstep(-bw - 0.42, -bw - 0.05, sd)) * arcSide;
    }
    if (kind == 0 || kind == 2) {
      float ph = fract(an - t * (0.35 + 0.5 * prog));
      sweep = pw(1.0 - ph, 6.0) * smoothstep(0.0, 0.04, ph);
    }
    if (kind == 0) {
      float cs = clamp(R * 0.09, 0.25, 0.55);
      float dotC = 1.0 - smoothstep(cs * 0.35, cs * 0.35 + fwidth(d) + 0.01, d);
      float arms = teleLine(min(abs(p.x), abs(p.y)), 0.03) * smoothstep(cs * 1.2, cs * 1.45, d) * (1.0 - smoothstep(cs * 2.6, cs * 3.3, d));
      ret = dotC * 0.9 + teleLine(d - cs, 0.035) + arms;
    }
    if (kind == 1 || kind == 3) {
      // AimIndicator chevrons: bands skewed by |x| into arrowheads (apex downrange), sawtooth so each one has a hard leading edge and a
      // fading tail
      float P = kind == 3 ? clamp(vM.w * 0.6, 0.9, 1.8) : clamp(R * 0.22, 0.9, 1.8);
      float kv = (kind == 3 ? p.y + abs(p.x) * 0.6 : d + abs(p.x) * 0.5) / P - t * (1.2 + 2.0 * prog);
      float fr = fract(kv);
      chev = pw(fr, 3.0) * (1.0 - smoothstep(0.93, 1.0, fr));
    }
    if (kind == 3) {
      float hw = max(vM.w * 0.5 - bw - 0.18, 0.1);
      float hl = clamp(vM.w * 0.5, 0.3, R * 0.3);
      float tipY = R - bw - 0.2;
      float tri = teleTri(p, vec2(-hw, tipY - hl), vec2(hw, tipY - hl), vec2(0.0, tipY));
      head = teleLine(tri, 0.035) + (1.0 - smoothstep(-0.02, 0.02, tri)) * 0.35;
    }

    float fin = (1.0 - smoothstep(0.0, 0.16, rem)) * stand;
    float beat = 1.0 + 0.22 * sin(t * (7.0 + 16.0 * prog * prog));
    // premultiplied layers: a dark rim-weighted wash, the band (dark body → bright outer lip), soft furniture, saturated line work and a
    // dark halo under the liner / timer front. The line work keeps the palette hue in its own body and the halo frames it, so both
    // still read on a bright floor (on a dark one the halo vanishes); the glow (addc) carries the bloom.
    float aW = inside * shown * (0.08 + 0.24 * rimW + charged * (0.12 + 0.22 * rimW)) * (0.7 + 0.6 * n) + fin * inside * 0.3;
    float aB = band * shown * (0.55 + 0.35 * outer) * (1.0 + 0.3 * pop) * beat;
    float aS = inside * shown * (contour * (0.18 + 0.26 * charged) + sweep * 0.3 * (1.0 - 0.5 * charged) + chev * (0.14 + 0.32 * charged)
      + veins * 0.18 * (0.3 + 0.7 * rimW)) * beat;
    float aL = inside * (shown * (liner * 0.9 + lip * 0.8 + tick * 0.7 + ret * 0.8 + head * 0.75) + front * 0.9 + snapB) * beat;
    float aH = inside * (shown * teleLine(sd + bw, 0.13) + teleLine(fm - pm, 0.16) * step(0.004, prog)) * (1.0 - clamp(liner + front, 0.0, 1.0)) * 0.5;
    float aSum = aW + aB + aS + aL + aH;
    a = clamp(aSum, 0.0, 1.0);
    col = (c1 * (aW * 0.75 + aS * 0.5 + aH * 0.2) + mix(c1, c0, outer) * aB + c0 * (aL + aS * 0.5)) / max(aSum, 0.001);
    vec3 hot = mix(c0, vec3(max(c0.r, max(c0.g, c0.b))), 0.5);
    addc = (c0 * (band * shown * (0.18 + 0.55 * outer) * (1.0 + 1.5 * pop) + lead * 0.25 + contour * charged * 0.25
      + chev * shown * (0.08 + 0.35 * charged) + sweep * 0.25 + snapB * 0.6)
      + hot * (shown * (liner * 0.4 + lip * 0.5 + tick * 0.25 + ret * 0.4 + head * 0.35) + front * 0.8 + snapB * 0.3))
      * beat * inside + (c0 * (0.5 + 1.2 * band) + hot * band * 0.5) * fin * inside;
  } else if (pat == 15) { // ground shadow (alpha), darkens with progress
    float n = tnz(vL.xz * 0.12 + seed, 0);
    float edge = gv + (n - 0.5) * 0.18;
    a = (1.0 - smoothstep(0.55, 1.0, edge)) * smoothstep(0.0, 0.8, prog) * 0.62;
    col = c1;
  } else if (pat == 16) { // arcane swirl disk
    float n = tnz(vec2(ang / TAU * 2.0 + t * 0.22, gv * 2.2 - t * 0.5), 0);
    float n2 = tnz(vec2(ang / TAU * 5.0 - t * 0.3, gv * 4.0 + t * 0.3), 1);
    float arms = smoothstep(0.35, 0.9, n * 0.6 + n2 * 0.5);
    float ring = smoothstep(0.03, 0.0, abs(gv - 0.94)) * 0.9;
    float body = pw(max(1.0 - gv, 0.0), 0.9);
    a = (arms * body * 0.9 + ring + body * 0.15) * smoothstep(1.0, 0.92, gv);
    col = mix(c1, c0, body * arms + ring);
    addc = c0 * ring * 0.4;
  } else if (pat == 18) { // claw scratch (lane): reveal window, tapered ends, hot centre line
    float sw = vE.x;
    float head = 1.0;
    float tail = 0.0;
    if (sw > 0.0) {
      head = easeOut3(clamp(prog / sw, 0.0, 1.0));
      tail = easeIn2(clamp((prog - sw * 0.5) / (1.0 - sw * 0.5), 0.0, 1.0));
    }
    float lead = 1.0 - smoothstep(head - 0.01, head + 0.02, gu);
    float rear = smoothstep(tail, tail + 0.12, gu);
    float s = 1.0 - abs(2.0 * gv - 1.0);
    float taper = pw(max(sin(PI * clamp(gu, 0.0, 1.0)), 0.0), 0.6);
    float prof = smoothstep(1.0 - taper, 1.0, s * 1.02);
    float n = tnz(vec2(gu * 3.0 + seed, gv * 2.0), 0);
    a = lead * rear * prof * (0.55 + 0.7 * n);
    float core = pw(s, 4.0) * taper;
    col = mix(c1, c0, core);
    addc = vec3(1.0) * core * core * lead * rear * 0.9;
    a *= 1.0 - smoothstep(0.75, 1.0, prog);
    addc *= 1.0 - smoothstep(0.75, 1.0, prog);
  } else if (pat == 19) { // C4 soft noisy ring: gaussian band inside the ring, broken along the angle, erodes with age
    float n1 = tnz(vec2(ang * 0.45 + seed, prog * 0.5 + gv * 0.3), 0);
    float n2 = tnz(vec2(ang * 1.7 - seed * 0.7, gv * 0.9 - t * 0.35), 1);
    float d = (gv - 0.7) / 0.24;
    float band = exp(-d * d);
    float body = smoothstep(0.0, 0.6, gv) * (1.0 - smoothstep(0.6, 1.0, gv)) * 0.3;
    float broken = smoothstep(0.2, 0.7, n1 * 0.7 + n2 * 0.5 + 0.2 - prog * 0.3);
    a = (band * (0.5 + 0.65 * n2) + body * n1) * broken;
    col = mix(c1, c0, band);
    addc = c0 * band * band * 0.22 * broken;
  } else if (pat == 20) { // C4 soft light column: no cap rim, vertical streak noise scrolling up, tapered top
    vec3 V = normalize(cameraPosition - vWp);
    float fres = pw(clamp(abs(dot(normalize(vNrm), V)), 0.0, 1.0), 0.9);
    float s1 = tnz(vec2(gu * 7.0 + seed, gv * 0.35 - t * 1.1), 0);
    float s2 = tnz(vec2(gu * 13.0 - seed, gv * 0.6 - t * 1.7), 1);
    float streak = smoothstep(0.35, 0.95, s1 * 0.65 + s2 * 0.45);
    float foot = smoothstep(0.0, 0.06, gv);
    float top = pw(1.0 - smoothstep(0.12, 0.95, gv), 1.6);
    a = fres * foot * top * (0.25 + 0.95 * streak);
    col = mix(c1, c0, top * streak);
    addc = c0 * fres * streak * top * top * 0.3;
  } else if (pat == 21) { // C4 heated cracks (alpha decal): Voronoi crack network (thick at the impact, hairline at the rim), cooling hot seam + char scar
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.0);
    vec2 v1 = vorEdge(wrp(pl * 2.1 + seed * 7.0, 0.5) , seed);
    vec2 v2 = vorEdge(wrp(pl * 5.2 + seed * 3.0, 0.35), seed + 9.0);
    float wc = mix(0.16, 0.045, smoothstep(0.0, 0.95, r));
    float wf = mix(0.1, 0.028, smoothstep(0.0, 0.95, r));
    float brk = smoothstep(0.22, 0.5, tnz(wrp(pl * 1.3 + seed, 0.5), 0) + (1.0 - r) * 0.4);
    float fine = smoothstep(0.38, 0.62, tnz(wrp(pl * 2.4 + seed * 2.0, 0.6), 1)) * (1.0 - smoothstep(0.35, 0.95, r));
    float k1 = 1.0 - smoothstep(wc * 0.45, wc, v1.y);
    float k2 = (1.0 - smoothstep(wf * 0.45, wf, v2.y)) * fine;
    float lines = max(k1 * brk, k2 * 0.85);
    float fall = (1.0 - smoothstep(0.55, 1.0, r));
    float core = max((1.0 - smoothstep(wc * 0.06, wc * 0.3, v1.y)) * brk, (1.0 - smoothstep(wf * 0.05, wf * 0.24, v2.y)) * fine * 0.7);
    float heat = 1.0 - smoothstep(0.04, 0.78, prog);
    float flick = 0.88 + 0.12 * sin(t * 9.0 + hash21(floor(pl * 6.0) + seed) * 6.0);
    a = lines * fall * 0.95;
    float hotMix = core * heat;
    col = mix(c1 * 0.5, mix(c0, vec3(1.0), pw(heat, 3.0) * 0.3), hotMix);
    addc = c0 * core * fall * heat * heat * flick * 1.2 + vec3(1.0) * core * fall * pw(heat, 4.0) * 0.25;
  } else if (pat == 22) { // C4 ground stain (alpha decal): ragged blob, darker wet lip, mottled body, splatter drops, wet glints
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.4);
    float n = tnz(wrp(pl * 0.6 + seed, 0.9), 0);
    float n2 = tnz(wrp(pl * 1.8 + seed * 3.0, 0.6), 1);
    float edge = r + (n - 0.5) * 0.55;
    float body = 1.0 - smoothstep(0.46, 0.8, edge);
    float lip = smoothstep(0.3, 0.6, edge) * (1.0 - smoothstep(0.6, 0.82, edge)) * body;
    float dn = tnz(wrp(pl * 2.1 + seed * 5.0, 1.6), 2) * 0.6 + tnz(wrp(pl * 4.3 - seed * 2.0, 1.2), 1) * 0.4;
    float drops = smoothstep(0.66, 0.72, dn) * smoothstep(0.35, 0.72, r) * (1.0 - smoothstep(0.78, 1.05, r));
    a = clamp(body * (0.62 + 0.38 * n2) + drops * 0.9, 0.0, 1.0);
    col = mix(c1, c1 * 0.5, lip);
    float gloss = smoothstep(0.78, 0.92, n2) * body * (1.0 - lip) * (1.0 - smoothstep(0.0, 0.9, prog));
    addc = c0 * gloss * 0.4;
  } else if (pat == 23) { // C4 impact crater (alpha decal): dark pit, raised dusty lip, radial ejecta streaks
    float R = max(vM.y, 0.01);
    vec2 pl = vL.xz / R;
    float r = clamp(length(pl), 0.0, 1.3);
    float an = atan(pl.x, pl.y);
    float n = tnz(wrp(pl * 0.7 + seed, 0.7), 0);
    float edge = r + (n - 0.5) * 0.22;
    float pit = 1.0 - smoothstep(0.2, 0.52, edge);
    float lip = smoothstep(0.38, 0.56, edge) * (1.0 - smoothstep(0.56, 0.84, edge));
    float st = tnz(vec2(an * 1.4 + seed, r * 0.5), 1);
    float streak = smoothstep(0.55, 0.9, st) * smoothstep(0.5, 0.7, edge) * (1.0 - smoothstep(0.78, 1.15, edge));
    a = max(max(pit * 0.9, lip * 0.78), streak * 0.5) * (0.72 + 0.28 * n);
    col = mix(c0, c1, pit);
  } else if (pat == 24) { // C4 light column on a vertical plane: soft across, streak noise scrolling up, tapered top, soft foot
    float x = abs(2.0 * gu - 1.0);
    float edgeW = 1.0 - smoothstep(0.5, 1.0, x);
    float s1 = tnz(vec2(gu * 6.0 + seed, gv * 0.35 - t * 1.1), 0);
    float s2 = tnz(vec2(gu * 11.0 - seed, gv * 0.6 - t * 1.7), 1);
    float streak = smoothstep(0.30, 0.95, s1 * 0.65 + s2 * 0.45);
    float foot = smoothstep(0.0, 0.06, gv);
    float top = pw(1.0 - smoothstep(0.12, 0.95, gv), 1.6);
    float mid = exp(-x * x * 3.2);
    a = edgeW * foot * top * (0.18 + 0.9 * streak) * (0.4 + 0.8 * mid);
    col = mix(c1, c0, top * streak * mid);
    addc = c0 * edgeW * streak * top * top * mid * 0.32;
  } else { // 17: thin rings stack (holy / heal pulse)
    float k = sin((gv * 3.0 - t * 0.9) * TAU) * 0.5 + 0.5;
    float n = tnz(vec2(ang * 0.4 + seed, gv + t * 0.2), 0);
    a = pw(k, 6.0) * (1.0 - gv) * (0.6 + 0.8 * n) + pw(1.0 - gv, 3.0) * 0.25;
    col = mix(c1, c0, 1.0 - gv);
  }

  // ground decals (scorch, pool, frost, shadow) take their opacity from the second colour's alpha
  bool decal = pat == 6 || pat == 7 || pat == 8 || pat == 15 || pat == 21 || pat == 22 || pat == 23;
  a *= decal ? env1 : env;
  addc *= env;
  vec3 rgb = col * a + addc;
  if (a < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) discard;
  gl_FragColor = vec4(rgb, a) * heroGuardFade();
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
