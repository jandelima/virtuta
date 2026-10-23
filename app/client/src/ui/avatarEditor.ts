import * as THREE from 'three';
import { BODIES, BOTTOM_COLORS, HAIR_COLORS, HEADS, SKIN_TONES, TOP_COLORS, buildCharacter, type Gender, type Look } from '../look';
import { icon } from './icons';

// Criador de avatar: prévia 3D girando à esquerda e as escolhas à direita.

const PREVIEW_W = 340, PREVIEW_H = 420, THUMB = 112;

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#ffffff', '#b7a991', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);
}

/** Renderizador único para as miniaturas de cabelo e roupa. */
class Thumbs {
  private r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  private scene = new THREE.Scene();
  private headCam = new THREE.OrthographicCamera(-0.32, 0.32, 0.32, -0.32, 0.1, 10);
  private bodyCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  constructor() {
    this.r.setSize(THUMB, THUMB);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    lights(this.scene);
    this.headCam.position.set(0.45, 0.66, 1.6);
    this.headCam.lookAt(0, 0.6, 0);
    this.bodyCam.position.set(0.5, 0.55, 1.6);
    this.bodyCam.lookAt(0, 0.42, 0);
  }
  shot(look: Look, part: 'head' | 'body') {
    const { model, animations } = buildCharacter(look);
    const mixer = new THREE.AnimationMixer(model);
    const idle = animations.find((a) => a.name === 'idle');
    if (idle) { mixer.clipAction(idle).play(); mixer.update(0.1); }
    model.rotation.y = 0.35;
    this.scene.add(model);
    this.r.render(this.scene, part === 'head' ? this.headCam : this.bodyCam);
    this.scene.remove(model);
    return this.r.domElement.toDataURL('image/png');
  }
  dispose() { this.r.dispose(); }
}

export function openAvatarEditor(initial: Look, name: string, onSave: (look: Look) => void) {
  let look: Look = { ...initial };
  const host = document.createElement('div');
  host.className = 'ae-backdrop';
  host.innerHTML = `
    <div class="ae" role="dialog" aria-modal="true" aria-labelledby="aeTitle">
      <div class="ae-prev">
        <canvas width="${PREVIEW_W}" height="${PREVIEW_H}"></canvas>
        <div class="ae-name">${name}</div>
        <small class="ae-hint">Arraste para girar</small>
      </div>
      <div class="ae-side">
        <div class="ae-head"><div><h2 id="aeTitle">Seu avatar</h2><p>É assim que a equipe vê você no escritório.</p></div><button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button></div>
        <div class="ae-opts">
          <div class="ae-gender" role="tablist">
            <button data-g="f" role="tab">Menina</button><button data-g="m" role="tab">Menino</button>
          </div>
          <section><h4>Cabelo</h4><div class="ae-thumbs" data-part="head"></div></section>
          <section><h4>Cor do cabelo</h4><div class="ae-sw" data-key="hair"></div></section>
          <section><h4>Pele</h4><div class="ae-sw" data-key="skin"></div></section>
          <section><h4>Roupa</h4><div class="ae-thumbs" data-part="body"></div></section>
          <section><h4>Cor da blusa</h4><div class="ae-sw" data-key="top"></div></section>
          <section><h4>Cor da calça</h4><div class="ae-sw" data-key="bottom"></div></section>
        </div>
        <div class="ae-foot"><button class="btn soft" data-random>${icon('shuffle')}Surpreenda-me</button><span></span><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Salvar avatar</button></div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const $ = <T extends Element>(q: string) => host.querySelector(q) as T;

  // --- prévia
  const canvas = $<HTMLCanvasElement>('canvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.setSize(PREVIEW_W, PREVIEW_H, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  lights(scene);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.42, 48), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.08 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cam = new THREE.OrthographicCamera(-0.52, 0.52, 0.64, -0.64, 0.1, 20);
  cam.position.set(0, 0.95, 3);
  cam.lookAt(0, 0.5, 0);
  const holder = new THREE.Group();
  holder.scale.setScalar(1.15);
  scene.add(holder);
  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let spin = -0.5, drag: number | null = null, idleSpin = true;

  function rebuildPreview(celebrate = false) {
    holder.clear();
    const built = buildCharacter(look);
    holder.add(built.model);
    clips = built.animations;
    mixer = new THREE.AnimationMixer(built.model);
    const idle = clips.find((c) => c.name === 'idle')!;
    const yes = clips.find((c) => c.name === 'emote-yes');
    if (celebrate && yes) {
      const a = mixer.clipAction(yes);
      a.setLoop(THREE.LoopOnce, 1);
      a.play();
      mixer.addEventListener('finished', () => { a.fadeOut(0.2); mixer!.clipAction(idle).reset().fadeIn(0.2).play(); });
    } else mixer.clipAction(idle).play();
  }

  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; idleSpin = false; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (drag !== null) { spin += (e.clientX - drag) * 0.012; drag = e.clientX; } });
  canvas.addEventListener('pointerup', () => { drag = null; });

  let last = performance.now(), raf = 0;
  const loop = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (idleSpin) spin += dt * 0.5;
    holder.rotation.y = spin;
    mixer?.update(dt);
    r.render(scene, cam);
    raf = requestAnimationFrame(loop);
  };

  // --- opções
  const thumbs = new Thumbs();
  const swatches = (key: 'hair' | 'skin' | 'top' | 'bottom', colors: string[], label: string) => {
    $(`.ae-sw[data-key="${key}"]`).innerHTML = colors
      .map((c, i) => `<button class="sw${look[key] === c ? ' on' : ''}" data-v="${c}" style="--c:${c}" aria-label="${label} ${i + 1}"></button>`)
      .join('');
  };
  const thumbRow = (part: 'head' | 'body') => {
    const list = part === 'head' ? HEADS[look.gender] : BODIES[look.gender];
    $(`.ae-thumbs[data-part="${part}"]`).innerHTML = list
      .map((m, i) => {
        const src = thumbs.shot({ ...look, [part]: m }, part);
        return `<button class="th${look[part] === m ? ' on' : ''}" data-v="${m}" aria-label="${part === 'head' ? 'Cabelo' : 'Roupa'} ${i + 1}"><img src="${src}" alt=""/></button>`;
      })
      .join('');
  };
  function render(parts: { head?: boolean; body?: boolean } = { head: true, body: true }) {
    host.querySelectorAll<HTMLButtonElement>('.ae-gender button').forEach((b) => {
      const on = b.dataset.g === look.gender;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (parts.head) thumbRow('head');
    if (parts.body) thumbRow('body');
    swatches('hair', HAIR_COLORS, 'Cor do cabelo');
    swatches('skin', SKIN_TONES, 'Tom de pele');
    swatches('top', TOP_COLORS, 'Cor da blusa');
    swatches('bottom', BOTTOM_COLORS, 'Cor da calça');
  }

  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === host || t.closest('[data-close]')) return close();
    const g = t.closest<HTMLElement>('[data-g]');
    if (g && g.dataset.g !== look.gender) {
      const gender = g.dataset.g as Gender;
      look = { ...look, gender, head: HEADS[gender][0], body: BODIES[gender][0] };
      render();
      rebuildPreview(true);
      return;
    }
    const th = t.closest<HTMLElement>('.th');
    if (th) {
      const part = (th.parentElement as HTMLElement).dataset.part as 'head' | 'body';
      look = { ...look, [part]: th.dataset.v! };
      th.parentElement!.querySelectorAll('.th').forEach((b) => b.classList.toggle('on', b === th));
      rebuildPreview(true);
      return;
    }
    const sw = t.closest<HTMLElement>('.sw');
    if (sw) {
      const key = (sw.parentElement as HTMLElement).dataset.key as 'hair' | 'skin' | 'top' | 'bottom';
      look = { ...look, [key]: sw.dataset.v! };
      // as miniaturas mostram as cores escolhidas
      render({ head: key === 'hair' || key === 'skin', body: key !== 'hair' });
      rebuildPreview();
      return;
    }
    if (t.closest('[data-random]')) {
      const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      const gender = look.gender;
      look = { gender, head: pick(HEADS[gender]), body: pick(BODIES[gender]), skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS), top: pick(TOP_COLORS), bottom: pick(BOTTOM_COLORS) };
      render();
      rebuildPreview(true);
      return;
    }
    if (t.closest('[data-save]')) {
      onSave(look);
      close();
    }
  });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);

  function close() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    thumbs.dispose();
    r.dispose();
    host.remove();
  }

  render();
  rebuildPreview();
  loop();
  ($('[data-save]') as HTMLButtonElement).focus();
}
