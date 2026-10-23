import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Interactive } from './space';

// Destaque do objeto sob o mouse: um véu da cor de destaque sobre o próprio objeto e um
// contorno em volta da silhueta (casca invertida, inflada pelas normais suavizadas).
// A geometria é montada na primeira vez que o objeto é destacado e reaproveitada depois.

interface Shape { fill: THREE.BufferGeometry; hull: THREE.BufferGeometry }

export class Highlight {
  readonly group = new THREE.Group();
  private readonly fillMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  // transparente só para entrar na mesma fila do véu e ser desenhado depois dele
  private readonly edgeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true });
  private readonly thick = { value: 0.02 };
  private readonly fill = new THREE.Mesh(undefined, this.fillMat);
  private readonly hull = new THREE.Mesh(undefined, this.edgeMat);
  private readonly cache = new Map<Interactive, Shape>();
  current: Interactive | null = null;

  constructor() {
    this.edgeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uThick = this.thick;
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'uniform float uThick;\nvoid main() {')
        .replace('#include <begin_vertex>', 'vec3 transformed = position + normal * uThick;');
    };
    this.fill.renderOrder = 4;
    this.hull.renderOrder = 5;
    this.fill.matrixAutoUpdate = this.hull.matrixAutoUpdate = false;
    this.group.add(this.hull, this.fill);
    this.group.visible = false;
  }

  setColor(c: string) {
    this.fillMat.color.set(c);
    this.edgeMat.color.set(c);
  }

  /** Espessura do contorno em pixels, convertida para metros no zoom atual. */
  setPixels(px: number, metersPerPixel: number) {
    this.thick.value = px * metersPerPixel;
  }

  /** Mostra o destaque em `it` (ou esconde). `soft` deixa só o contorno, mais leve. */
  show(it: Interactive | null, soft = false) {
    this.current = it;
    this.group.visible = !!it;
    if (!it) return;
    const s = this.shape(it);
    this.fill.geometry = s.fill;
    this.hull.geometry = s.hull;
    // objeto sem malha visível (vão da porta): o véu vira uma folha translúcida que tapa a
    // parte de trás da casca, deixando só o contorno
    const ghost = it.meshes.every((m) => m.userData.ghost);
    this.fill.visible = !soft || ghost;
    this.fillMat.opacity = ghost ? (soft ? 0.12 : 0.22) : 0.18;
    this.fillMat.depthWrite = ghost;
    this.edgeMat.opacity = soft ? 0.65 : 1;
  }

  private shape(it: Interactive): Shape {
    // objetos que mudam (jardim crescendo) são remontados a cada destaque
    const live = it.meshes.some((m) => isLive(m));
    const hit = this.cache.get(it);
    if (hit && !live) return hit;
    if (hit) { hit.fill.dispose(); hit.hull.dispose(); }
    const geos = it.meshes.filter((m) => m.visible || !m.parent).map((m) => {
      if (isLive(m)) m.updateWorldMatrix(true, false);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', m.geometry.attributes.position.clone());
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      g.applyMatrix4(m.matrixWorld);
      return g.index ? g.toNonIndexed() : g;
    });
    const fill = mergeGeometries(geos, false) ?? new THREE.BufferGeometry();
    geos.forEach((g) => g.dispose());
    // normais suavizadas: a casca infla sem abrir frestas nas quinas
    const hull = mergeVertices(fill.clone(), 1e-3);
    hull.computeVertexNormals();
    const s = { fill, hull };
    this.cache.set(it, s);
    return s;
  }
}

function isLive(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.dynamic) return true;
  return false;
}
