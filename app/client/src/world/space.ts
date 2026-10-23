import * as THREE from 'three';
import { furniture } from '../assets';
import { NavGrid } from './nav';

/** Escala dos móveis do kit em relação aos personagens. */
export const FS = 1.6;

export const FACE = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 } as const;
export type Facing = keyof typeof FACE;

export interface Zone {
  id: string;
  name: string;
  x1: number; z1: number; x2: number; z2: number;
  tint: string;
  /** Subárea que, para o destaque, pertence a outra sala. */
  parent?: string;
}

export interface Seat {
  id: string;
  x: number; z: number; y: number;
  rot: number;
  /** Altura medida no estofado do próprio modelo (falso para assentos macios, ajustados à mão). */
  auto?: boolean;
  /** Ponto livre de entrada e saída, calculado sob demanda. */
  access?: { x: number; z: number };
}

/**
 * Objeto do cenário com que se interage clicando nele (quadro, mesa, cadeira, rádio...).
 * Guarda as malhas originais: depois da junção do cenário elas saem da cena, mas continuam
 * servindo para saber o que está sob o mouse e para desenhar o destaque.
 */
export interface Interactive {
  /** Ação: 'board:sala', 'mesa:3', 'porta', 'radio', 'seat'... */
  id: string;
  title: string;
  hint: string;
  meshes: THREE.Mesh[];
  box: THREE.Box3;
  /** Assentos do objeto (cadeira, sofá); vazio nos demais. */
  seats: string[];
}

/**
 * Parte alta de uma parede de vidro que some para quem está dentro da sala `room`, para que
 * ninguém fique escondido atrás dela; `cap` é o perfil que arremata a parede rebaixada.
 */
export interface Cutaway { room: string; upper: THREE.Group; cap: THREE.Group }

export interface WallSeg { x1: number; z1: number; x2: number; z2: number; kind: 'solid' | 'glass' | 'low'; }

export const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 0.92 }),
  wallLow: new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 0.92 }),
  cap: new THREE.MeshStandardMaterial({ color: '#30343c', roughness: 0.6 }),
  frame: new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.45, metalness: 0.4 }),
  /** Perfil claro de alumínio das divisórias de vidro (o preto pesava na frente das mesas). */
  rail: new THREE.MeshStandardMaterial({ color: '#c3c8cf', roughness: 0.4, metalness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: '#bcd6ea', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }),
  window: new THREE.MeshStandardMaterial({ color: '#d4e6f4', roughness: 0.05, emissive: '#000000', transparent: true, opacity: 0.22, depthWrite: false }),
  sill: new THREE.MeshStandardMaterial({ color: '#ebe8e2', roughness: 0.6 }),
  slab: new THREE.MeshStandardMaterial({ color: '#c9c4bb', roughness: 1 }),
};

let boxGeo: THREE.BoxGeometry | null = null;

// cópias tingidas reaproveitadas: o mesmo material para todos os móveis da mesma cor
const tintCache = new Map<string, THREE.MeshStandardMaterial>();
function tinted(src: THREE.MeshStandardMaterial, tint: string) {
  const key = `${src.uuid}:${tint}`;
  let m = tintCache.get(key);
  if (!m) {
    m = src.clone();
    m.color.multiply(new THREE.Color(tint));
    tintCache.set(key, m);
  }
  return m;
}

export class Space {
  readonly group = new THREE.Group();
  readonly nav: NavGrid;
  readonly zones: Zone[] = [];
  readonly seats = new Map<string, Seat>();
  readonly interactives: Interactive[] = [];
  readonly walls: WallSeg[] = [];
  readonly cutaways: Cutaway[] = [];
  /** Onde `box` coloca as peças (a cena, ou o grupo da parte alta de uma parede). */
  private into: THREE.Object3D = this.group;
  readonly lamps: THREE.PointLight[] = [];
  readonly glowMats: THREE.MeshStandardMaterial[] = [];
  spawn = new THREE.Vector3();

  constructor(readonly id: string, readonly name: string, readonly w: number, readonly d: number) {
    this.nav = new NavGrid(0, 0, w, d);
    this.group.name = id;
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, shadow = true) {
    boxGeo ??= new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y + sy / 2, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.into.add(m);
    return m;
  }

  floor(x1: number, z1: number, x2: number, z2: number, mat: THREE.Material, tile = 2) {
    const w = x2 - x1, d = z2 - z1;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w + x1) / tile, (uv.getY(i) * d + z1) / tile);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x1 + w / 2, 0, z1 + d / 2);
    m.receiveShadow = true;
    m.userData.floor = true;
    this.group.add(m);
    return m;
  }

  zone(id: string, name: string, x1: number, z1: number, x2: number, z2: number, tint: string, parent?: string) {
    this.zones.push({ id, name, x1, z1, x2, z2, tint, parent });
  }

  zoneAt(x: number, z: number) {
    // a zona menor ganha, para que salas dentro de áreas abertas sejam reconhecidas
    let best: Zone | undefined;
    for (const zn of this.zones) {
      if (x >= zn.x1 && x <= zn.x2 && z >= zn.z1 && z <= zn.z2) {
        if (!best || (zn.x2 - zn.x1) * (zn.z2 - zn.z1) < (best.x2 - best.x1) * (best.z2 - best.z1)) best = zn;
      }
    }
    return best;
  }

  /** Posiciona um modelo do kit pelo centro da base, com rotação e bloqueio na navegação. */
  model(name: string, x: number, z: number, o: { rot?: number; s?: number | [number, number, number]; y?: number; block?: boolean; pad?: number; tint?: string } = {}) {
    const inner = furniture(name).clone(true);
    if (o.tint) {
      inner.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.material = tinted(m.material as THREE.MeshStandardMaterial, o.tint!);
      });
    }
    const s = o.s ?? FS;
    if (Array.isArray(s)) inner.scale.set(s[0], s[1], s[2]);
    else inner.scale.setScalar(s);
    inner.updateMatrixWorld(true);
    const local = new THREE.Box3().setFromObject(inner);
    const c = local.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -local.min.y, -c.z);
    const g = new THREE.Group();
    g.add(inner);
    g.rotation.y = o.rot ?? 0;
    g.position.set(x, o.y ?? 0, z);
    this.group.add(g);
    g.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(g);
    if (o.block !== false) {
      const p = o.pad ?? 0.2;
      this.nav.block(wb.min.x - p, wb.min.z - p, wb.max.x + p, wb.max.z + p);
    }
    return { obj: g, box: wb, top: wb.max.y };
  }

  seat(id: string, x: number, z: number, facing: Facing | number, y: number) {
    this.seats.set(id, { id, x, z, y, rot: typeof facing === 'number' ? facing : FACE[facing] });
  }

  /** Torna objetos já montados clicáveis, com destaque ao passar o mouse. */
  interactive(id: string, title: string, hint: string, objs: THREE.Object3D[], seats: string[] = []) {
    const meshes: THREE.Mesh[] = [];
    for (const o of objs) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
    const it: Interactive = { id, title, hint, meshes, box: new THREE.Box3(), seats };
    this.interactives.push(it);
    return it;
  }

  /** Cadeira (ou sofá) clicável: registra os assentos e o objeto. */
  sittable(obj: THREE.Object3D, ...seats: string[]) {
    return this.interactive('seat', '', 'Sentar', [obj], seats);
  }

  /**
   * Calcula as caixas dos objetos clicáveis e mede a altura de cada assento no estofado do
   * próprio modelo; chamar com o cenário montado, antes da junção.
   */
  finalize() {
    this.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const it of this.interactives) {
      const topAt = (x: number, z: number) => {
        ray.set(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
        let top = -1;
        for (const m of it.meshes) {
          const h = ray.intersectObject(m, false)[0];
          if (h) top = Math.max(top, h.point.y);
        }
        return top;
      };
      for (const id of it.seats) {
        const s = this.seats.get(id)!;
        if (s.auto === false) continue;
        const seatTop = topAt(s.x, s.z);
        if (seatTop < 0) continue;
        // encosto: o primeiro ponto atrás do quadril bem mais alto que o assento; as costas do
        // boneco precisam de uns 22 cm de folga, senão atravessam o encosto
        const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
        for (let d = 0.02; d <= 0.5; d += 0.02) {
          if (topAt(s.x - fx * d, s.z - fz * d) > seatTop + 0.12) {
            const push = Math.min(0.15, 0.22 - d);
            if (push > 0) { s.x += fx * push; s.z += fz * push; }
            break;
          }
        }
        // o quadril fica um pouco acima do estofado
        const top = topAt(s.x, s.z);
        s.y = (top > 0 ? top : seatTop) + 0.02;
      }
    }
    for (const it of this.interactives) {
      it.box.makeEmpty();
      for (const m of it.meshes) {
        m.updateMatrixWorld(true);
        m.geometry.computeBoundingBox();
        it.box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
      }
    }
  }

  lamp(x: number, y: number, z: number, color = '#ffc98a', intensity = 6, distance = 6) {
    const l = new THREE.PointLight(color, 0, distance, 1.6);
    l.position.set(x, y, z);
    l.userData.night = intensity;
    this.group.add(l);
    this.lamps.push(l);
    return l;
  }

  /**
   * Parede alinhada a um eixo. `open` são vãos (portas); `windows` são janelas
   * com peitoril e verga; `glass` faz uma divisória de vidro, só com perfis em cima e embaixo
   * (e nas pontas), sem montantes no meio.
   */
  wall(x1: number, z1: number, x2: number, z2: number, o: { h: number; t?: number; open?: [number, number][]; windows?: [number, number][]; glass?: boolean; low?: boolean; cut?: { room: string; y: number } }) {
    const horiz = z1 === z2;
    const a = horiz ? Math.min(x1, x2) : Math.min(z1, z2);
    const b = horiz ? Math.max(x1, x2) : Math.max(z1, z2);
    const fixed = horiz ? z1 : x1;
    const t = o.t ?? (o.glass ? 0.06 : 0.14);
    const cuts = [...(o.open ?? [])].sort((p, q) => p[0] - q[0]);
    const pieces: [number, number][] = [];
    let cur = a;
    for (const [s, e] of cuts) {
      if (s > cur) pieces.push([cur, s]);
      cur = Math.max(cur, e);
    }
    if (cur < b) pieces.push([cur, b]);

    const put = (s: number, e: number, y0: number, y1: number, mat: THREE.Material, th = t) => {
      const len = e - s, mid = (s + e) / 2;
      if (len <= 0 || y1 <= y0) return;
      // vidro não faz sombra
      const shadow = mat !== MAT.glass;
      if (horiz) this.box(mid, y0, fixed, len, y1 - y0, th, mat, shadow);
      else this.box(fixed, y0, mid, th, y1 - y0, len, mat, shadow);
    };
    // vidro com perfis só em cima, embaixo e nas pontas
    const pane = (s: number, e: number, y0: number, y1: number) => {
      put(s, e, y0, y1, MAT.glass, 0.03);
      put(s, s + 0.04, y0, y1, MAT.rail, 0.06);
      put(e - 0.04, e, y0, y1, MAT.rail, 0.06);
    };
    let cut: Cutaway | null = null;
    if (o.cut) {
      cut = { room: o.cut.room, upper: new THREE.Group(), cap: new THREE.Group() };
      for (const g of [cut.upper, cut.cap]) { g.userData.dynamic = true; this.group.add(g); }
      cut.cap.visible = false;
      this.cutaways.push(cut);
    }

    for (const [s, e] of pieces) {
      if (o.glass) {
        put(s, e, 0, 0.05, MAT.rail, 0.06);
        if (cut) {
          const y = o.cut!.y;
          pane(s, e, 0, y);
          this.into = cut.upper;
          pane(s, e, y, o.h);
          put(s, e, o.h - 0.04, o.h, MAT.rail, 0.06);
          this.into = cut.cap;
          put(s, e, y - 0.04, y, MAT.rail, 0.07);
          this.into = this.group;
        } else {
          pane(s, e, 0, o.h);
          put(s, e, o.h - 0.04, o.h, MAT.rail, 0.06);
        }
      } else {
        const wins = (o.windows ?? []).filter(([ws, we]) => we > s && ws < e).map(([ws, we]) => [Math.max(ws, s), Math.min(we, e)] as [number, number]);
        let c2 = s;
        const sill = 0.7, head = Math.min(o.h - 0.25, 1.85);
        for (const [ws, we] of wins) {
          put(c2, ws, 0, o.h, o.low ? MAT.wallLow : MAT.wall);
          put(ws, we, 0, sill, MAT.wall);
          put(ws, we, head, o.h, MAT.wall);
          put(ws, we, sill, head, MAT.window, 0.02);
          put(ws - 0.03, we + 0.03, sill - 0.05, sill, MAT.sill, t + 0.18);
          put(ws, ws + 0.05, sill, head, MAT.frame, t + 0.02);
          put(we - 0.05, we, sill, head, MAT.frame, t + 0.02);
          put(ws, we, head - 0.05, head, MAT.frame, t + 0.02);
          put(ws, we, sill, sill + 0.04, MAT.frame, t + 0.02);
          const panes = Math.max(2, Math.round((we - ws) / 0.9));
          for (let k = 1; k < panes; k++) {
            const m = ws + ((we - ws) * k) / panes;
            put(m - 0.02, m + 0.02, sill, head, MAT.frame, 0.06);
          }
          c2 = we;
        }
        put(c2, e, 0, o.h, o.low ? MAT.wallLow : MAT.wall);
        put(s, e, o.h, o.h + 0.03, MAT.cap, t + 0.01);
      }
      const pad = 0.24;
      if (horiz) this.nav.block(s - pad, fixed - pad, e + pad, fixed + pad);
      else this.nav.block(fixed - pad, s - pad, fixed + pad, e + pad);
      this.walls.push(horiz ? { x1: s, z1: fixed, x2: e, z2: fixed, kind: o.glass ? 'glass' : o.h < 1 ? 'low' : 'solid' } : { x1: fixed, z1: s, x2: fixed, z2: e, kind: o.glass ? 'glass' : o.h < 1 ? 'low' : 'solid' });
    }
    // garante que os vãos fiquem livres mesmo com o acolchoamento das peças vizinhas
    for (const [s, e] of cuts) {
      if (horiz) this.nav.open(s + 0.05, fixed - 0.3, e - 0.05, fixed + 0.3);
      else this.nav.open(fixed - 0.3, s + 0.05, fixed + 0.3, e - 0.05);
    }
  }
}
