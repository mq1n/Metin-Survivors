declare module 'xatlasjs/dist/node/api.mjs' {
  export const Api: (createModule: unknown) => unknown;
}
declare module 'xatlasjs/dist/node/xatlas.js' {
  const createXAtlasModule: unknown;
  export default createXAtlasModule;
}
