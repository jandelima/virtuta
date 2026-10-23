import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Junta as malhas paradas que usam o mesmo material numa só. O cenário cai de centenas
 * para dezenas de chamadas de desenho, o que pesa muito menos em notebooks.
 * Objetos marcados com `userData.dynamic` (placas, bilhetes, porta, jardim) ficam de fora.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; cast: boolean; noDim: boolean; order: number }>();
  const walk = (o: THREE.Object3D, noDim: boolean) => {
    if (o.userData.dynamic) return;
    noDim ||= !!o.userData.noDim;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material)) {
      const g = m.geometry;
      const attrs = Object.keys(g.attributes).sort().join(',');
      const key = `${m.material.uuid}|${attrs}|${g.index ? 'i' : 'n'}|${m.castShadow ? 1 : 0}|${noDim ? 1 : 0}|${m.renderOrder}`;
      let e = groups.get(key);
      if (!e) groups.set(key, (e = { mat: m.material, geos: [], meshes: [], cast: m.castShadow, noDim, order: m.renderOrder }));
      e.geos.push(g.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
      e.meshes.push(m);
    }
    for (const c of [...o.children]) walk(c, noDim);
  };
  for (const c of [...root.children]) walk(c, false);

  let before = 0, after = 0;
  for (const e of groups.values()) {
    before += e.meshes.length;
    if (e.meshes.length < 2) { after++; e.geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(e.geos, false);
    e.geos.forEach((g) => g.dispose());
    if (!merged) { after += e.meshes.length; continue; }
    const mesh = new THREE.Mesh(merged, e.mat);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = true;
    mesh.renderOrder = e.order;
    mesh.userData.noDim = e.noDim;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const m of e.meshes) m.removeFromParent();
    after++;
  }
  // grupos que ficaram vazios saem da cena
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && o.type === 'Group' && !o.children.length && !o.userData.dynamic) empty.push(o); });
  empty.forEach((o) => o.removeFromParent());
  // o que é estático não precisa recalcular matriz a cada quadro (o dinâmico continua livre)
  const freeze = (o: THREE.Object3D) => {
    if (o.userData.dynamic) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    o.children.forEach(freeze);
  };
  root.children.forEach(freeze);
  return { before, after };
}
