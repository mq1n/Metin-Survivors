// Ground normal-map fade worker (render/terrain/layerTextures.ts, payload policy ARCHITECTURE §11): the normal maps of a
// zone's ground layers are fetched after the first seconds of the run and fade in from the flat normal. Turning a 1024²
// image into the layer's pixels (draw + getImageData) costs ~25 ms on the main thread, which would be a visible hitch for
// every one of the ~15 steps, so it happens here. One job in (an ImageBitmap, transferred), one reply per fade step out
// (the layer's RGBA pixels, transferred).
export interface NormalJob {
  id: number;
  bitmap: ImageBitmap;
  size: number;
  /** share of the map's relief in each step (0..1); the rest is the flat normal */
  mixes: readonly number[];
}

export interface NormalReply {
  id: number;
  mix: number;
  /** `size`² RGBA bytes; empty when the 2d context is unavailable */
  pixels: ArrayBuffer;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<NormalJob>) => void) | null;
  postMessage(msg: NormalReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent<NormalJob>): void => {
  const { id, bitmap, size, mixes } = e.data;
  const g = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
  for (const mix of mixes) {
    if (!g) {
      scope.postMessage({ id, mix, pixels: new ArrayBuffer(0) });
      continue;
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgb(128,128,255)';
    g.fillRect(0, 0, size, size);
    g.globalAlpha = mix;
    g.drawImage(bitmap, 0, 0, size, size);
    const pixels = g.getImageData(0, 0, size, size).data.buffer as ArrayBuffer;
    scope.postMessage({ id, mix, pixels }, [pixels]);
  }
  bitmap.close();
};
