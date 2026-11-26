import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]!);
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh();
  if (m) console.log(n.getName(), 'parent=', n.getParentNode()?.getName(), 'mesh=', m.getName(), 'skin=', !!n.getSkin(), 'prims=', m.listPrimitives().length, 'tris=', m.listPrimitives().reduce((a,p)=>a+(p.getIndices()?.getCount()??0)/3,0), 'mats=', m.listPrimitives().map(p=>p.getMaterial()?.getName()).join(','));
}
