import * as THREE from 'three';
import { crown } from './world/halloween';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildCharacter, disposeCharacter, resolveLook } from './look';
import type { NavGrid } from './world/nav';
import type { Seat } from './world/space';
import { STATUS_COLOR, STATUS_ICON, type Person } from './people';
import { icon } from './ui/icons';
import { esc } from './ui/dom';

/** Metros por segundo; a animação de andar acompanha para os pés não deslizarem. */
const WALK_SPEED = 2.6;
/** Escala dos personagens em relação aos modelos originais. */
export const CHAR_SCALE = 1.35;

/** Modelo 3D de uma pessoa: o visual escolhido ou, sem personalização, o do personagem do kit. */
export function characterModel(p: Person) {
  return buildCharacter(resolveLook(p.look, p.model));
}

// sombra simples no chão: bem mais leve que projetar o personagem no mapa de sombras
const blobGeo = new THREE.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({
  map: (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    r.addColorStop(0, 'rgba(0,0,0,0.42)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })(),
  transparent: true,
  depthWrite: false,
});

/**
 * Ponto livre por onde se entra e sai de um assento: atrás da cadeira, dos lados ou,
 * para sofás encostados, na frente. Calculado uma vez por assento.
 */
export function seatAccess(nav: NavGrid, s: Seat) {
  if (s.access) return s.access;
  const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
  const tries: [number, number][] = [[-fx * 0.6, -fz * 0.6], [fz * 0.6, -fx * 0.6], [-fz * 0.6, fx * 0.6], [fx * 0.7, fz * 0.7], [-fx * 0.85, -fz * 0.85]];
  for (const [dx, dz] of tries) {
    if (nav.walkable(s.x + dx, s.z + dz)) return (s.access = { x: s.x + dx, z: s.z + dz });
  }
  const p = nav.nearestWalkable(s.x, s.z);
  return (s.access = p ? { x: p.x, z: p.y } : { x: s.x, z: s.z });
}

export class Avatar {
  readonly root = new THREE.Group();
  readonly label: CSS2DObject;
  private readonly labelEl: HTMLDivElement;
  private mixer!: THREE.AnimationMixer;
  private model?: THREE.Object3D;
  private mountedAppearance = '';
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private path: THREE.Vector3[] = [];
  private onArrive?: () => void;
  private targetRot = 0;
  private emoteTimer = 0;
  seat?: Seat;
  speaking = false;
  /** Em conversa reservada (cadeado sobre o grupo). */
  locked = false;
  /** Falando para a sala. */
  announcing = false;
  inCall = false;
  micOn = false;

  constructor(readonly person: Person) {
    this.mount();

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'tag';
    this.label = new CSS2DObject(this.labelEl);
    this.label.position.set(0, 0.8 * CHAR_SCALE + 0.22, 0);
    this.label.center.set(0.5, 1);
    this.root.add(this.label);
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.position.y = 0.012;
    blob.renderOrder = 1;
    this.root.add(blob);
    this.refreshLabel();
    this.play('idle');
  }

  /** Cria (ou recria, ao trocar o visual) o modelo e as animações, mantendo a pose atual. */
  /** Remonta o visual (o tema de época mudou e as fantasias aparecem ou somem). */
  remount() { this.mount(); }

  private crownObj: THREE.Object3D | null = null;
  /** Coroinha de abóbora de quem lidera a caça. */
  setCrown(on: boolean) {
    if (on === !!this.crownObj) return;
    if (on) {
      this.crownObj = crown();
      // flutua acima do nome, para aparecer mesmo com chapéu ou cabeça de abóbora
      this.crownObj.position.set(0, 0.8 * CHAR_SCALE + 0.62, 0);
      this.root.add(this.crownObj);
    } else { this.crownObj!.removeFromParent(); this.crownObj = null; }
  }

  private mount() {
    const { model, animations } = characterModel(this.person);
    const playing = this.current ? [...this.actions].find(([, a]) => a === this.current)?.[0] : undefined;
    if (this.model) { this.mixer.stopAllAction(); this.root.remove(this.model); disposeCharacter(this.model); }
    model.scale.setScalar(CHAR_SCALE);
    model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    this.root.add(model);
    this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions.clear();
    this.current = undefined;
    for (const clip of animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    if (playing) this.play(playing, 0);
    this.mountedAppearance = JSON.stringify([this.person.model, this.person.look]);
  }

  /** Reconcilia os dados recebidos com o visual que está realmente desenhado. */
  setPerson(person: Person) {
    const appearance = JSON.stringify([person.model, person.look]);
    Object.assign(this.person, person);
    if (appearance !== this.mountedAppearance) this.mount();
    this.refreshLabel();
  }

  /** Libera as malhas geradas para este personagem (ao sair de cena). */
  dispose() { if (this.model) disposeCharacter(this.model); }

  get pos() { return this.root.position; }
  get moving() { return this.path.length > 0; }

  refreshLabel() {
    const p = this.person;
    // disponível é um ponto; os outros estados têm ícone próprio (também no rótulo compacto)
    const si = STATUS_ICON[p.status];
    const dot = si ? `<i class="dot sic" style="color:${STATUS_COLOR[p.status]}">${icon(si)}</i>` : `<i class="dot" style="background:${STATUS_COLOR[p.status]}"></i>`;
    const lock = this.locked ? icon('lock', 'st lock') : '';
    const mic = this.inCall ? icon(this.micOn ? 'mic' : 'micOff', this.micOn ? 'mic on' : 'mic') : '';
    const weak = p.unstable ? icon('wifiOff', 'st weak') : '';
    this.labelEl.className = `tag${p.me ? ' me' : ''}${this.speaking ? ' speaking' : ''}${p.guest ? ' guest' : ''}${p.unstable ? ' unstable' : ''}`;
    const hand = p.hand ? '<span class="hand" title="Mão levantada">✋</span>' : '';
    const ann = this.announcing ? icon('volume', 'st ann') : '';
    this.labelEl.innerHTML = `${dot}<b>${esc(p.short)}${p.me ? ' (você)' : ''}</b>${hand}${ann}${lock}${weak}${mic}`;
  }

  /** Rótulo compacto: só a bolinha de status, sem o nome. */
  setCompact(compact: boolean) {
    this.labelEl.classList.toggle('compact', compact && !this.person.me && !this.person.hand);
  }

  setActive(active: boolean) {
    this.root.visible = active;
    this.label.visible = active;
  }

  play(name: string, fade = 0.25) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    next.timeScale = name === 'walk' ? 1.25 * WALK_SPEED / 2.1 : 1;
    this.current?.fadeOut(fade);
    this.current = next;
  }

  /** Toca uma animação curta e volta à anterior. */
  emote(name = 'emote-yes', seconds = 1.4) {
    if (this.seat || this.moving) return;
    this.play(name, 0.15);
    this.emoteTimer = seconds;
  }

  private standUp() {
    if (!this.seat) return;
    this.seat = undefined;
    this.root.position.y = 0;
  }

  /** Anda até (x, z). Se estiver sentada, primeiro sai da cadeira pelo ponto de acesso. */
  goTo(nav: NavGrid, x: number, z: number, onArrive?: () => void) {
    const exit = this.seat ? seatAccess(nav, this.seat) : null;
    const from = exit ?? this.pos;
    const path = nav.findPath(from.x, from.z, x, z);
    if (!path) return false;
    this.standUp();
    if (exit) path.unshift(new THREE.Vector3(exit.x, 0, exit.z));
    this.path = path;
    this.onArrive = onArrive;
    this.play('walk');
    return true;
  }

  sit(seat: Seat) {
    this.path = [];
    this.seat = seat;
    this.root.position.set(seat.x, seat.y, seat.z);
    this.root.rotation.y = this.targetRot = seat.rot;
    this.play('sit', 0.3);
  }

  /** Sai da cadeira andando até o ponto de acesso dela. */
  leaveSeat(nav: NavGrid) {
    if (!this.seat) return;
    const a = seatAccess(nav, this.seat);
    this.standUp();
    this.path = [new THREE.Vector3(a.x, 0, a.z)];
    this.onArrive = undefined;
    this.play('walk');
  }

  /** Anda até o ponto de acesso da cadeira, entra nela e senta, sem teletransporte. */
  goSit(nav: NavGrid, seat: Seat, then?: () => void) {
    const a = seatAccess(nav, seat);
    return this.goTo(nav, a.x, a.z, () => {
      this.path = [new THREE.Vector3(seat.x, 0, seat.z)];
      this.onArrive = () => { this.sit(seat); then?.(); };
      this.play('walk');
    });
  }

  place(x: number, z: number, rot = 0) {
    this.path = [];
    this.seat = undefined;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = this.targetRot = rot;
    this.play('idle', 0);
  }

  /** Pessoas remotas: anda até a última posição recebida, ou senta se ela estiver sentada. */
  follow(x: number, z: number, rot: number, seat: Seat | null) {
    if (seat) {
      if (this.seat !== seat) this.sit(seat);
      return;
    }
    if (this.seat) this.standUp();
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > 4) { this.place(x, z, rot); return; }
    if (d < 0.02) {
      this.path = [];
      this.targetRot = rot;
      if (this.current === this.actions.get('walk')) this.play('idle');
      return;
    }
    this.path = [new THREE.Vector3(x, 0, z)];
    this.remoteRot = rot;
    this.onArrive = () => { this.targetRot = this.remoteRot; };
    this.play('walk');
  }
  private remoteRot = 0;

  face(rot: number) { this.targetRot = rot; }
  faceTowards(x: number, z: number) { this.targetRot = Math.atan2(x - this.pos.x, z - this.pos.z); }

  stop() {
    this.path = [];
    this.onArrive = undefined;
    if (!this.seat) this.play('idle');
  }

  /** Movimento direto pelo teclado, com deslizamento nas paredes. */
  steer(dx: number, dz: number, dt: number, nav: NavGrid) {
    const len = Math.hypot(dx, dz);
    if (len < 0.01) {
      if (!this.path.length && !this.seat && this.current === this.actions.get('walk')) this.play('idle');
      return false;
    }
    if (this.seat) {
      // pelo teclado, sai da cadeira pelo ponto de acesso
      const a = seatAccess(nav, this.seat);
      this.standUp();
      this.root.position.x = a.x;
      this.root.position.z = a.z;
    }
    this.path = [];
    this.onArrive = undefined;
    if (!nav.walkable(this.pos.x, this.pos.z)) {
      const p = nav.nearestWalkable(this.pos.x, this.pos.z);
      if (p) { this.root.position.x = p.x; this.root.position.z = p.y; }
    }
    const step = WALK_SPEED * dt;
    const nx = this.pos.x + (dx / len) * step, nz = this.pos.z + (dz / len) * step;
    if (nav.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else if (nav.walkable(nx, this.pos.z)) this.pos.x = nx;
    else if (nav.walkable(this.pos.x, nz)) this.pos.z = nz;
    this.targetRot = Math.atan2(dx, dz);
    this.play('walk');
    return true;
  }

  update(dt: number) {
    if (this.path.length) {
      const t = this.path[0];
      const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz), step = WALK_SPEED * dt;
      if (d <= step) {
        this.pos.x = t.x; this.pos.z = t.z;
        this.path.shift();
        if (!this.path.length) {
          this.play('idle');
          const cb = this.onArrive;
          this.onArrive = undefined;
          cb?.();
        }
      } else {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.targetRot = Math.atan2(dx, dz);
      }
    }
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0 && !this.seat && !this.path.length) this.play('idle');
    }
    let diff = this.targetRot - this.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.root.rotation.y += diff * Math.min(1, dt * 10);
    this.mixer.update(dt);
  }
}
