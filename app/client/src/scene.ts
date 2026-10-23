import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MAT, type Space, type Zone } from './world/space';
import { enableRoomFocus, focusedRoom, setFocusColors, setFocusRoom, setFocusStyle, updateRoomFocus } from './world/roomFocus';
import type { Avatar } from './avatar';

// Renderização do escritório: câmera isométrica, luz, tema, anéis das conversas e laço de quadros.
// Pensado para pesar pouco: sombra do cenário calculada uma vez, resolução limitada e quadros
// espaçados quando nada se mexe.

export type Theme = 'day' | 'night';
const VIEW_DIR = new THREE.Vector3(1, 1.15, 1).normalize();
const BASE_VIEW = 12;
// parado, o boneco ainda respira: 30 quadros mantêm a animação suave e custam metade
const IDLE_FPS = 30;

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels = new CSS2DRenderer();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  private hemi = new THREE.HemisphereLight('#ffffff', '#c9bda6', 2.1);
  private sun = new THREE.DirectionalLight('#fff1de', 1.9);
  private ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#d6dad5', roughness: 1 }));
  private rings: THREE.Group[] = [];
  private clickMarker: THREE.Mesh;
  private camTarget = new THREE.Vector3();
  private framed: Zone | null = null;
  /** Cena reduzida a uma faixa ao lado do quadro ou da apresentação: segue a pessoa, sem enquadrar a sala. */
  private side = false;
  private zoomBeforeSide = 1.15;
  private lastFrame = 0;
  private lastRender = 0;
  private activeUntil = 0;
  space!: Space;
  theme: Theme = 'day';
  zoom = 1.15;
  /** Pessoa (ou ponto) que a câmera acompanha. */
  follow: () => THREE.Vector3 = () => this.camTarget;
  onFrame: (dt: number) => void = () => {};
  onTheme: () => void = () => {};
  /** A sala onde a pessoa está mudou (null no salão). */
  onRoom: (room: Zone | null) => void = () => {};

  constructor(readonly viewport: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // o cenário não se mexe: a sombra é calculada só quando algo muda (tema, porta)
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewport.appendChild(this.renderer.domElement);
    this.labels.domElement.className = 'labels';
    viewport.appendChild(this.labels.domElement);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.41;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.clickMarker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 40), new THREE.MeshBasicMaterial({ color: '#3b5bdb', transparent: true, opacity: 0, depthWrite: false }));
    this.clickMarker.rotation.x = -Math.PI / 2;
    this.clickMarker.position.y = 0.025;
    this.scene.add(this.clickMarker);
    // "luz apagada" fora da sala: o escurecimento vem antes do mapeamento de tons, por isso é forte aqui
    setFocusStyle({ desat: 0.35, dark: 0.68, fade: 0 });

    new ResizeObserver(() => this.resize()).observe(viewport);
    // qualquer interação acelera os quadros por alguns segundos
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(ev, () => this.wake(), { passive: true });
  }

  setSpace(sp: Space) {
    this.space = sp;
    this.scene.add(sp.group);
    enableRoomFocus(sp.group);
    const cx = sp.w / 2, cz = sp.d / 2;
    this.sun.position.set(cx - 14, 26, cz - 10);
    this.sun.target.position.set(cx, 0, cz);
    const s = Math.max(sp.w, sp.d) * 0.72;
    const c = this.sun.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = 1; c.far = 80;
    c.updateProjectionMatrix();
    this.applyTheme(this.theme);
  }

  setSide(on: boolean) {
    if (on === this.side) return;
    this.side = on;
    if (on) { this.zoomBeforeSide = this.zoom; this.zoom = 1.25; }
    else this.zoom = this.framed ? this.roomZoom(this.framed) : this.zoomBeforeSide;
    this.wake();
  }

  wake(ms = 2500) { this.activeUntil = performance.now() + ms; }
  refreshShadows() { this.renderer.shadowMap.needsUpdate = true; this.wake(); }

  resize() {
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
    // resolução limitada: em telas muito densas, 1,5x já fica nítido e custa bem menos
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    const a = w / Math.max(1, h);
    Object.assign(this.camera, { left: (-BASE_VIEW * a) / 2, right: (BASE_VIEW * a) / 2, top: BASE_VIEW / 2, bottom: -BASE_VIEW / 2 });
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  accent() { return this.theme === 'night' ? '#f2b443' : '#3b5bdb'; }

  applyTheme(theme: Theme) {
    this.theme = theme;
    const night = theme === 'night';
    document.documentElement.dataset.theme = night ? 'dark' : 'light';
    this.scene.background = new THREE.Color(night ? '#0d1015' : '#e2e5e9');
    this.hemi.color.set(night ? '#7486b3' : '#ffffff');
    this.hemi.groundColor.set(night ? '#2a2520' : '#d9d2c4');
    this.hemi.intensity = night ? 0.6 : 2.1;
    this.sun.color.set(night ? '#9fb3ff' : '#fff1de');
    this.sun.intensity = night ? 0.45 : 1.9;
    this.sun.shadow.intensity = night ? 0.6 : 0.42;
    (this.ground.material as THREE.MeshStandardMaterial).color.set(night ? '#151a20' : '#d6dad5');
    MAT.window.color.set(night ? '#1f2c44' : '#d7e8f5');
    MAT.window.emissive.set(night ? '#14223d' : '#000000');
    MAT.slab.color.set(night ? '#2a2c30' : '#c9c4bb');
    this.renderer.toneMappingExposure = night ? 1.15 : 1.0;
    if (this.space) {
      for (const l of this.space.lamps) l.intensity = night ? (l.userData.night as number) : 0;
      for (const m of this.space.glowMats) m.emissiveIntensity = night ? 1.0 : 0.5;
    }
    const acc = this.accent();
    setFocusColors(this.scene.background as THREE.Color);
    for (const r of this.rings) r.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(acc));
    (this.clickMarker.material as THREE.MeshBasicMaterial).color.set(acc);
    this.onTheme();
    this.refreshShadows();
  }

  markClick(x: number, z: number) {
    this.clickMarker.position.set(x, 0.025, z);
    (this.clickMarker.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.clickMarker.scale.setScalar(1);
    this.wake();
  }

  /** Ponto do chão (ou objeto) sob o cursor. */
  pick(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.space.group, true).find((h) => h.object.visible && h.point.y < 1.3);
    const ground = new THREE.Vector3();
    const onGround = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ground);
    return { hit: hit?.point ?? null, ground: onGround ? ground : null };
  }

  /** Posição de um ponto do mundo na tela (para saber o que está sob o mouse). */
  toScreen(p: THREE.Vector3) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
  }

  /** Anéis no chão em volta de cada conversa visível. */
  drawConvs(groups: Avatar[][]) {
    while (this.rings.length < groups.length) this.rings.push(this.makeRing());
    this.rings.forEach((r, i) => {
      const g = groups[i];
      r.visible = !!g && g.length > 1;
      if (!r.visible) { r.userData.key = ''; return; }
      // elipse que abraça o grupo: eixo maior na direção do par mais distante
      let pa = g[0], pb = g[g.length - 1], far = -1;
      for (const x of g) for (const y of g) {
        const dd = Math.hypot(x.pos.x - y.pos.x, x.pos.z - y.pos.z);
        if (dd > far) { far = dd; pa = x; pb = y; }
      }
      const cx = (pa.pos.x + pb.pos.x) / 2, cz = (pa.pos.z + pb.pos.z) / 2;
      let ang = Math.atan2(pb.pos.z - pa.pos.z, pb.pos.x - pa.pos.x);
      if (ang < 0) ang += Math.PI;
      let side = 0;
      for (const x of g) side = Math.max(side, Math.abs(-(x.pos.x - cx) * Math.sin(ang) + (x.pos.z - cz) * Math.cos(ang)));
      const major = far / 2 + 0.62, minor = side + 0.62;
      const key = g.map((x) => x.person.id).sort().join();
      const k = r.userData.key === key ? 0.2 : 1;
      r.userData.key = key;
      r.position.x += (cx - r.position.x) * k;
      r.position.z += (cz - r.position.z) * k;
      let dAng = -ang - r.rotation.y;
      dAng = Math.atan2(Math.sin(2 * dAng), Math.cos(2 * dAng)) / 2;
      r.rotation.y += dAng * k;
      r.scale.x += (major - r.scale.x) * k;
      r.scale.z += (minor - r.scale.z) * k;
    });
  }

  private makeRing() {
    const acc = this.accent();
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: acc, transparent: true, opacity: 0.1, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 96), new THREE.MeshBasicMaterial({ color: acc, transparent: true, opacity: 0.65, depthWrite: false }));
    disc.rotation.x = ring.rotation.x = -Math.PI / 2;
    g.add(disc, ring);
    g.position.y = 0.02;
    g.renderOrder = 2;
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  /** Zoom que faz a sala (com paredes) caber na área visível, com uma margem. */
  private roomZoom(z: Zone) {
    // orientação final da câmera (no primeiro quadro ela ainda não foi posicionada)
    const ref = new THREE.Object3D();
    ref.position.copy(VIEW_DIR);
    ref.lookAt(0, 0, 0);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ref.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ref.quaternion);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [z.x1, z.x2]) for (const zz of [z.z1, z.z2]) for (const y of [0, 2.4]) {
      const p = new THREE.Vector3(x, y, zz);
      minX = Math.min(minX, p.dot(right)); maxX = Math.max(maxX, p.dot(right));
      minY = Math.min(minY, p.dot(up)); maxY = Math.max(maxY, p.dot(up));
    }
    const aspect = this.viewport.clientWidth / Math.max(1, this.viewport.clientHeight);
    return THREE.MathUtils.clamp(Math.min((BASE_VIEW * aspect) / (maxX - minX), BASE_VIEW / (maxY - minY)) * 0.88, 0.5, 2.4);
  }

  start() {
    this.resize();
    this.camTarget.copy(this.follow());
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private frame(t: number) {
    const dt = THREE.MathUtils.clamp((t - (this.lastFrame || t)) / 1000, 0, 0.05);
    this.lastFrame = t;
    this.onFrame(dt);

    // destaque da sala atual e enquadramento ao entrar numa sala
    const focus = this.follow();
    setFocusRoom(this.space, focus.x, focus.z);
    updateRoomFocus(dt);
    const room = focusedRoom();
    if (room !== this.framed) {
      this.framed = room;
      this.onRoom(room);
      if (room && !this.side) this.zoom = this.roomZoom(room);
      this.wake();
    }
    const target = room && !this.side ? new THREE.Vector3((room.x1 + room.x2) / 2, 0, (room.z1 + room.z2) / 2) : focus;
    const k = 1 - Math.exp(-dt * 4);
    const before = this.camTarget.clone();
    this.camTarget.x += (THREE.MathUtils.clamp(target.x, 2, this.space.w - 2) - this.camTarget.x) * k;
    this.camTarget.z += (THREE.MathUtils.clamp(target.z, 2, this.space.d - 2) - this.camTarget.z) * k;
    this.camera.position.copy(this.camTarget).addScaledVector(VIEW_DIR, 60);
    this.camera.lookAt(this.camTarget);
    const zoomBefore = this.camera.zoom;
    this.camera.zoom += (this.zoom - this.camera.zoom) * k;
    this.camera.updateProjectionMatrix();
    if (before.distanceToSquared(this.camTarget) > 1e-6 || Math.abs(zoomBefore - this.camera.zoom) > 1e-4) this.wake(300);

    const cm = this.clickMarker.material as THREE.MeshBasicMaterial;
    if (cm.opacity > 0) { cm.opacity = Math.max(0, cm.opacity - dt * 1.4); this.clickMarker.scale.multiplyScalar(1 + dt * 0.8); }

    // sem movimento, desenha só alguns quadros por segundo (as animações de respirar continuam)
    const active = t < this.activeUntil;
    if (!active && t - this.lastRender < 1000 / IDLE_FPS) return;
    this.lastRender = t;
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
