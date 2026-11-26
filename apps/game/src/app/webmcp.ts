// Progressive-enhancement WebMCP (Web Model Context Protocol) tool registration for in-browser AI agents.
// Registers read-only discovery and public API tools whenever the browser exposes navigator.modelContext or document.modelContext.

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(args?: Record<string, unknown>): Promise<unknown>;
}

interface ModelContextLike {
  registerTool?: (tool: WebMcpTool) => void;
}

const VALID_MODES = new Set(['solo', 'coop']);
const VALID_ZONES = new Set(['yeonmu', 'suryeon', 'seori', 'daeryeol']);
const VALID_DIFFS = new Set(['normal', 'hard', 'nightmare']);
const VALID_CLASSES = new Set(['all', 'warrior', 'ninja', 'yacha', 'shaman', 'wolfman']);
const VALID_PERIODS = new Set(['all', 'week', 'day']);

let registered = false;

export function registerWebMcpTools(): void {
  if (registered || typeof window === 'undefined') return;
  const navCtx = (navigator as Navigator & { modelContext?: ModelContextLike }).modelContext;
  const docCtx = (document as Document & { modelContext?: ModelContextLike }).modelContext;
  const ctx = navCtx?.registerTool ? navCtx : docCtx?.registerTool ? docCtx : null;
  if (!ctx?.registerTool) return;
  registered = true;

  const tools: WebMcpTool[] = [
    {
      name: 'get_game_overview',
      description: 'Return Metin Survivors overview, supported classes, doctrines, zones, co-op capabilities, and current live UI state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const app = window.__ms;
        return {
          title: 'Metin Survivors',
          url: 'https://metin-survivors.com/',
          genre: '3D Browser Action Roguelite (Survivors-like)',
          freeToPlay: true,
          players: { min: 1, max: 4, coop: true },
          languages: ['tr', 'en'],
          classes: [
            { id: 'warrior', doctrines: ['sinew', 'spirit'] },
            { id: 'ninja', doctrines: ['silent_edge', 'quiver'] },
            { id: 'yacha', doctrines: ['spellsteel', 'hexcraft'] },
            { id: 'shaman', doctrines: ['talisman', 'stormbalm'] },
            { id: 'wolfman', doctrines: ['redmane', 'moonmane'] },
          ],
          zones: ['yeonmu', 'suryeon', 'seori', 'daeryeol'],
          bosses: 20,
          skills: 114,
          liveState: app
            ? {
                screen: app.store.screen.value,
                selection: app.store.selection.value,
                fps: app.store.fps.value,
              }
            : null,
        };
      },
    },
    {
      name: 'get_leaderboard',
      description: 'Fetch public Metin Survivors leaderboard entries for a given mode, zone, difficulty, hero class, and time period.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['solo', 'coop'], default: 'solo' },
          zone: { type: 'string', enum: ['yeonmu', 'suryeon', 'seori', 'daeryeol'], default: 'yeonmu' },
          difficulty: { type: 'string', enum: ['normal', 'hard', 'nightmare'], default: 'normal' },
          classId: { type: 'string', enum: ['all', 'warrior', 'ninja', 'yacha', 'shaman', 'wolfman'], default: 'all' },
          period: { type: 'string', enum: ['all', 'week', 'day'], default: 'all' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (args = {}) => {
        const mode = typeof args.mode === 'string' && VALID_MODES.has(args.mode) ? args.mode : 'solo';
        const zone = typeof args.zone === 'string' && VALID_ZONES.has(args.zone) ? args.zone : 'yeonmu';
        const difficulty = typeof args.difficulty === 'string' && VALID_DIFFS.has(args.difficulty) ? args.difficulty : 'normal';
        const cls = typeof args.classId === 'string' && VALID_CLASSES.has(args.classId) ? args.classId : 'all';
        const period = typeof args.period === 'string' && VALID_PERIODS.has(args.period) ? args.period : 'all';
        const rawLim = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 10;
        const limit = Math.min(50, Math.max(1, rawLim));
        const qs = new URLSearchParams({ mode, zone, difficulty, class: cls, period, limit: String(limit) });
        const resp = await fetch(`/api/v1/leaderboard?${qs.toString()}`, { headers: { Accept: 'application/json' } });
        if (!resp.ok) return { ok: false, status: resp.status };
        return await resp.json();
      },
    },
    {
      name: 'check_service_health',
      description: 'Check live Metin Survivors backend API, D1 database, and R2 storage health.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const resp = await fetch('/api/v1/health', { headers: { Accept: 'application/json' } });
        return { ok: resp.ok, status: resp.status, body: await resp.json().catch(() => null) };
      },
    },
  ];

  for (const tool of tools) {
    try {
      ctx.registerTool(tool);
    } catch {
      /* ignore browser polyfill / duplicate registration errors */
    }
  }
}
