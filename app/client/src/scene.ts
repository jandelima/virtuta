import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MAT, type Space } from './world/space';
import { HUB, type Rect } from '../../shared/layout';
import type { Avatar } from './avatar';

// Renderização do ambiente atual: câmera isométrica que acompanha a pessoa sem sair do ambiente,
// luz, tema, anéis das conversas e laço de quadros.
// Pensado para pesar pouco: sombra do cenário calculada uma vez, resolução limitada e quadros
// espaçados quando nada se mexe.

export type Theme = 'day' | 'night';
const VIEW_DIR = new THREE.Vector3(1, 1.15, 1).normalize();
const BASE_VIEW = 12;
// eixos da tela no mundo (a câmera nunca gira)
const VIEW_AXES = (() => {
  const ref = new THREE.Object3D();
  ref.position.copy(VIEW_DIR);
  ref.lookAt(0, 0, 0);
  return { right: new THREE.Vector3(1, 0, 0).applyQuaternion(ref.quaternion), up: new THREE.Vector3(0, 1, 0).applyQuaternion(ref.quaternion) };
})();
/** Quanto do lado de fora das paredes (corredor, gramado) a câmera pode mostrar, em metros. */
const VIEW_PAD = 0.6;
// parado, o boneco ainda respira: 30 quadros mantêm a animação suave e custam metade
const IDLE_FPS = 30;
// com a janela em segundo plano (ou uma janela do app por cima), o escritório segue vivo, mas leve
const BACKGROUND_FPS = 10, BACKGROUND_ACTIVE_FPS = 30;
/**
 * Acima disso (ms por quadro, em movimento) a resolução desce um degrau. Fica acima de 33 ms
 * de propósito: o modo de economia de energia do navegador limita a 30 quadros sem a máquina
 * estar lenta, e isso não deve borrar a cena.
 */
const SLOW_FRAME = 38;

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
  /** Cena reduzida a uma faixa ao lado do quadro ou da apresentação: segue a pessoa, sem enquadrar a sala. */
  private side = false;
  private zoomBeforeSide = 1.15;
  private lastFrame = 0;
  private lastRender = 0;
  private activeUntil = 0;
  /**
   * Qualidade adaptativa: degraus de resolução, do mais nítido ao mais leve. A cena mede o
   * próprio ritmo em movimento e desce um degrau quando não acompanha; de tempos em tempos
   * tenta subir de novo. No último degrau, as luminárias da noite também se apagam.
   */
  private dprSteps: number[] = [];
  private dprStep = 0;
  private frameTimes: number[] = [];
  private nextUpgrade = 0;
  private lowPower = false;
  space!: Space;
  theme: Theme = 'day';
  zoom = 1.15;
  /** Pessoa que a câmera acompanha. */
  follow: () => THREE.Vector3 = () => this.camTarget;
  onFrame: (dt: number) => void = () => {};
  onTheme: () => void = () => {};

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

    new ResizeObserver(() => this.resize()).observe(viewport);
    // qualquer interação acelera os quadros por alguns segundos
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(ev, () => this.wake(), { passive: true });
  }

  /** Mostra só este ambiente; a câmera vai direto para ele, sem atravessar o caminho. */
  setSpace(sp: Space) {
    if (this.space === sp) return;
    if (this.space) this.scene.remove(this.space.group);
    this.space = sp;
    this.scene.add(sp.group);
    const r = sp.rect, cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
    this.sun.position.set(cx - 14, 26, cz - 10);
    this.sun.target.position.set(cx, 0, cz);
    const s = Math.max(r.x2 - r.x1, r.z2 - r.z1) * 0.72 + 1;
    const c = this.sun.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = 1; c.far = 80;
    c.updateProjectionMatrix();
    if (!this.side) this.zoom = this.baseZoom();
    this.camTarget.copy(this.viewTarget());
    this.camera.zoom = this.zoom;
    this.applyTheme(this.theme);
  }

  setSide(on: boolean) {
    if (on === this.side) return;
    this.side = on;
    if (on) { this.zoomBeforeSide = this.zoom; this.zoom = 1.25; }
    else this.zoom = this.space ? this.baseZoom() : this.zoomBeforeSide;
    this.wake();
  }

  /** Volta ao zoom de sempre (depois de o zoom ter sido mudado à mão). */
  reframe() { if (this.space && !this.side) { this.zoom = this.baseZoom(); this.wake(); } }

  /** Alterna entre o ambiente inteiro na tela e o zoom de sempre. */
  toggleWhole() {
    if (!this.space || this.side) return;
    const whole = this.fitZoom(this.space.rect);
    this.zoom = Math.abs(this.zoom - whole) < 0.01 ? this.baseZoom() : whole;
    this.wake();
  }

  wake(ms = 2500) { this.activeUntil = performance.now() + ms; }
  refreshShadows() { this.renderer.shadowMap.needsUpdate = true; this.wake(); }

  resize() {
    const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
    // resolução limitada: em telas muito densas, 1,5x já fica nítido e custa bem menos
    const max = Math.min(devicePixelRatio, 1.5);
    if (this.dprSteps[0] !== max) {
      this.dprSteps = [...new Set([max, 1.25, 1, 0.85, 0.75].filter((d) => d <= max))];
      this.dprStep = Math.min(this.dprStep, this.dprSteps.length - 1);
    }
    this.renderer.setPixelRatio(this.dprSteps[this.dprStep]);
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    const a = w / Math.max(1, h);
    Object.assign(this.camera, { left: (-BASE_VIEW * a) / 2, right: (BASE_VIEW * a) / 2, top: BASE_VIEW / 2, bottom: -BASE_VIEW / 2 });
    this.camera.updateProjectionMatrix();
    // a janela mudou de tamanho: o ambiente volta a caber inteiro
    this.reframe();
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
      // de dia as luminárias nem entram no cálculo da luz (cada uma pesa em todos os pixels)
      for (const l of this.space.lamps) { l.intensity = night ? (l.userData.night as number) : 0; l.visible = night && !this.lowPower; }
      for (const m of this.space.glowMats) m.emissiveIntensity = night ? 1.0 : 0.5;
    }
    const acc = this.accent();
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

  /** Extensão de um retângulo do chão (com paredes de 2,4 m) nos eixos da tela. */
  private extent(r: Rect, pad = 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [r.x1 - pad, r.x2 + pad]) for (const z of [r.z1 - pad, r.z2 + pad]) for (const y of [0, 2.4]) {
      const p = new THREE.Vector3(x, y, z);
      minX = Math.min(minX, p.dot(VIEW_AXES.right)); maxX = Math.max(maxX, p.dot(VIEW_AXES.right));
      minY = Math.min(minY, p.dot(VIEW_AXES.up)); maxY = Math.max(maxY, p.dot(VIEW_AXES.up));
    }
    return { minX, maxX, minY, maxY };
  }

  private get aspect() { return this.viewport.clientWidth / Math.max(1, this.viewport.clientHeight); }

  /** Zoom que faz o retângulo (com paredes) caber na área visível, com uma margem. */
  private fitZoom(r: Rect) {
    const e = this.extent(r);
    return THREE.MathUtils.clamp(Math.min((BASE_VIEW * this.aspect) / (e.maxX - e.minX), BASE_VIEW / (e.maxY - e.minY)) * 0.88, 0.5, 2.4);
  }

  /**
   * Zoom de sempre: o do hub inteiro. As pessoas têm o mesmo tamanho nos três ambientes, e na
   * sala da equipe, maior, a câmera acompanha quem anda.
   */
  private baseZoom() { return this.fitZoom(HUB); }

  /**
   * Ponto do chão para onde a câmera olha: a pessoa, mas só até a vista encostar nas paredes,
   * para não mostrar o lado de fora. Se o ambiente cabe inteiro, fica centralizado.
   */
  private viewTarget() {
    const p = this.follow();
    const e = this.extent(this.space.rect, VIEW_PAD);
    const halfW = (BASE_VIEW * this.aspect) / 2 / this.zoom, halfH = BASE_VIEW / 2 / this.zoom;
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
    const sx = clamp(p.dot(VIEW_AXES.right), e.minX + halfW, e.maxX - halfW);
    const sy = clamp(p.dot(VIEW_AXES.up), e.minY + halfH, e.maxY - halfH);
    // de volta ao chão: deslizar na direção da câmera não muda o ponto na tela
    const t = -(sx * VIEW_AXES.right.y + sy * VIEW_AXES.up.y) / VIEW_DIR.y;
    return VIEW_AXES.right.clone().multiplyScalar(sx).addScaledVector(VIEW_AXES.up, sy).addScaledVector(VIEW_DIR, t);
  }

  start() {
    this.resize();
    this.reframe();
    this.camera.zoom = this.zoom;
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private frame(t: number) {
    const dt = THREE.MathUtils.clamp((t - (this.lastFrame || t)) / 1000, 0, 0.05);
    this.lastFrame = t;
    this.onFrame(dt);

    // a câmera acompanha a pessoa aos poucos, sem mostrar o lado de fora do ambiente
    const target = this.viewTarget();
    const k = 1 - Math.exp(-dt * 4);
    const before = this.camTarget.clone();
    this.camTarget.lerp(target, k);
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
    const fg = document.hasFocus() && !document.body.classList.contains('modal-open');
    const fps = fg ? (active ? 0 : IDLE_FPS) : (active ? BACKGROUND_ACTIVE_FPS : BACKGROUND_FPS);
    if (fps && t - this.lastRender < 1000 / fps - 2) return;
    if (fg && active) this.measure(t - this.lastRender, t);
    this.lastRender = t;
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  /** Ajusta a resolução pelo ritmo dos quadros em movimento (sem limite de quadros). */
  private measure(dt: number, t: number) {
    if (dt <= 0 || dt > 200) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = this.frameTimes.sort((a, b) => a - b), median = sorted[45];
    this.frameTimes = [];
    const last = this.dprSteps.length - 1;
    if (median > SLOW_FRAME) {
      if (this.dprStep < last) { this.dprStep++; this.resize(); }
      else if (!this.lowPower) { this.lowPower = true; this.applyTheme(this.theme); }
      // depois de descer, só tenta subir de novo daqui a um tempo
      this.nextUpgrade = t + 120_000;
    } else if (median < 18 && this.dprStep > 0 && t > this.nextUpgrade) {
      this.dprStep--;
      this.resize();
      this.nextUpgrade = t + 120_000;
    }
  }

  /** Degrau de qualidade atual (para diagnóstico). */
  quality() { return { dpr: this.renderer.getPixelRatio(), step: this.dprStep, lowPower: this.lowPower }; }

  stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
