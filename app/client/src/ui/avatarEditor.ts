import * as THREE from 'three';
import {
  CAPE_COLORS, CLOTH_COLORS, COSTUME_NAMES, FACE_NAMES, FACIAL_NAMES, GEAR_COLORS, GLASSES_NAMES, HAIR_COLORS, HAIR_NAMES, HAT_NAMES, OUTFIT_NAMES, SKIN_TONES,
  buildCharacter, costumesActive, disposeCharacter, hasDetail, type Look,
} from '../look';
import { COSTUMES, FACES, FACIAL, GLASSES, HAIR_STYLES, HATS, OUTFITS } from '../../../shared/look';
import { icon } from './icons';
import { esc } from './dom';

// Criador de avatar: prévia 3D à esquerda e, à direita, as escolhas em abas. Cada opção mostra
// uma miniatura com o próprio visual da pessoa, então o que se escolhe é o que aparece depois.

const PREVIEW_W = 360, PREVIEW_H = 440, THUMB = 120;
/** Imagem vazia enquanto a miniatura não fica pronta. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
type Tab = 'rosto' | 'cabelo' | 'roupa' | 'acessorios';
type ColorKey = 'skin' | 'hair' | 'top' | 'detail' | 'bottom' | 'shoes' | 'frame' | 'hatColor' | 'phonesColor' | 'capeColor';
type Shot = 'head' | 'body';

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#ffffff', '#b7a991', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);
}

/** Renderizador único para as miniaturas das opções. */
class Thumbs {
  private r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  private scene = new THREE.Scene();
  private cams: Record<Shot, THREE.OrthographicCamera> = {
    head: new THREE.OrthographicCamera(-0.27, 0.27, 0.27, -0.27, 0.1, 10),
    body: new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10),
  };
  constructor() {
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.r.setSize(THUMB, THUMB);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    lights(this.scene);
    this.cams.head.position.set(0.5, 0.75, 1.6);
    this.cams.head.lookAt(0, 0.6, 0);
    this.cams.body.position.set(0.5, 0.6, 1.6);
    this.cams.body.lookAt(0, 0.44, 0);
  }
  shot(look: Look, kind: Shot) {
    const { model, animations } = buildCharacter(look);
    const mixer = new THREE.AnimationMixer(model);
    const idle = animations.find((a) => a.name === 'idle');
    if (idle) { mixer.clipAction(idle).play(); mixer.update(0.1); }
    model.rotation.y = 0.35;
    this.scene.add(model);
    this.r.render(this.scene, this.cams[kind]);
    this.scene.remove(model);
    disposeCharacter(model);
    return this.r.domElement.toDataURL('image/png');
  }
  dispose() { this.r.dispose(); this.r.forceContextLoss(); }
}

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** Visual aleatório, mas coerente: acessórios só de vez em quando. */
function randomLook(): Look {
  const chance = (p: number) => Math.random() < p;
  return {
    hairStyle: pick(HAIR_STYLES.filter((h) => h !== 'none' || chance(0.3))), face: pick(FACES), outfit: pick(OUTFITS),
    skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS.slice(0, 11)), top: pick(CLOTH_COLORS), detail: pick(CLOTH_COLORS),
    bottom: pick(CLOTH_COLORS.filter((c) => ['#1e3a8a', '#26292f', '#4b5563', '#7a5a3a', '#c9b48f', '#355e3b', '#111216', '#9ca3af'].includes(c))),
    shoes: pick(['#111216', '#26292f', '#f4f4f5', '#7a5a3a', '#4a3527', '#d6453d', '#3b5bdb']),
    glasses: chance(0.35) ? pick(GLASSES.slice(1)) : 'none', frame: pick(GEAR_COLORS),
    facial: chance(0.25) ? pick(FACIAL.slice(1)) : 'none',
    hat: chance(0.2) ? pick(HATS.slice(1)) : 'none', hatColor: pick(CLOTH_COLORS),
    headphones: chance(0.15), phonesColor: pick(GEAR_COLORS), earrings: chance(0.2),
    // no Halloween, o "Surpreenda-me" às vezes também fantasia
    costume: costumesActive() && chance(0.5) ? pick(COSTUMES.slice(1)) : 'none', cape: costumesActive() && chance(0.3), capeColor: pick(CAPE_COLORS),
  };
}

export interface EditorOptions {
  /** Primeira entrada: sem cancelar, e o botão final leva ao escritório. */
  welcome?: boolean;
}

export function openAvatarEditor(initial: Look, name: string, onSave: (look: Look) => Promise<void>, opts: EditorOptions = {}) {
  let look: Look = { ...initial };
  let saving = false;
  let tab: Tab = 'rosto';
  const host = document.createElement('div');
  host.className = 'ae-backdrop';
  host.innerHTML = `
    <div class="ae" role="dialog" aria-modal="true" aria-labelledby="aeTitle">
      <div class="ae-prev">
        <canvas width="${PREVIEW_W}" height="${PREVIEW_H}"></canvas>
        <div class="ae-name">${esc(name)}</div>
        <small class="ae-hint">Arraste para girar</small>
      </div>
      <div class="ae-side">
        <div class="ae-head"><div><h2 id="aeTitle">${opts.welcome ? 'Crie seu avatar' : 'Seu avatar'}</h2>
          <p>${opts.welcome ? 'É assim que a equipe vai ver você no escritório. Dá para mudar depois, pelo seu menu.' : 'É assim que a equipe vê você no escritório.'}</p></div>
          ${opts.welcome ? '' : `<button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button>`}</div>
        <div class="tabs ae-tabs" role="tablist">${(['rosto', 'cabelo', 'roupa', 'acessorios'] as Tab[]).map((t) => `<button class="tab" role="tab" data-tab="${t}">${{ rosto: 'Rosto', cabelo: 'Cabelo', roupa: 'Roupa', acessorios: 'Acessórios' }[t]}</button>`).join('')}</div>
        <div class="ae-opts"></div>
        <p class="ae-error" role="alert" hidden></p>
        <div class="ae-foot"><button class="btn soft" data-random>${icon('shuffle')}Surpreenda-me</button><span></span>
          ${opts.welcome ? '' : '<button class="btn ghost" data-close>Cancelar</button>'}
          <button class="btn primary" data-save>${opts.welcome ? 'Entrar no escritório' : 'Salvar avatar'}</button></div>
        <div class="ae-foot ae-ask" hidden><b>Descartar as alterações do avatar?</b><span></span><button class="btn ghost" data-keep>Continuar editando</button><button class="btn danger" data-discard>Descartar</button></div>
      </div>
    </div>`;
  document.body.appendChild(host);
  document.body.classList.add('modal-open');
  const $ = <T extends Element>(q: string) => host.querySelector(q) as T;
  const optsEl = $<HTMLElement>('.ae-opts');

  // --- prévia: corpo inteiro na roupa, mais perto do rosto nas outras abas
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
  const cam = new THREE.OrthographicCamera(-0.54, 0.54, 0.66, -0.66, 0.1, 20);
  const holder = new THREE.Group();
  holder.scale.setScalar(1.15);
  scene.add(holder);
  const framing = { body: { zoom: 1, y: 0.5 }, head: { zoom: 1.4, y: 0.62 } };
  const view = { zoom: 1, y: 0.5 };
  let model: THREE.Object3D | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let spin = -0.5, drag: number | null = null, idleSpin = true;

  function rebuildPreview(celebrate = false) {
    if (model) { holder.remove(model); disposeCharacter(model); }
    const built = buildCharacter(look);
    model = built.model;
    holder.add(model);
    mixer = new THREE.AnimationMixer(model);
    const idle = built.animations.find((c) => c.name === 'idle')!;
    const yes = built.animations.find((c) => c.name === 'emote-yes');
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
    const want = framing[tab === 'roupa' ? 'body' : 'head'], k = 1 - Math.exp(-dt * 8);
    view.zoom += (want.zoom - view.zoom) * k;
    view.y += (want.y - view.y) * k;
    cam.zoom = view.zoom;
    cam.updateProjectionMatrix();
    cam.position.set(0, view.y + 0.45, 3);
    cam.lookAt(0, view.y, 0);
    mixer?.update(dt);
    r.render(scene, cam);
    raf = requestAnimationFrame(loop);
  };

  // --- opções
  // as miniaturas são desenhadas depois do clique, poucas por quadro, para a prévia responder
  // na hora; até lá cada opção mostra a imagem anterior
  const thumbs = new Thumbs();
  const shots = new Map<string, string>(), lastShot = new Map<string, string>();
  let queue: { key: string; slot: string; look: Look; kind: Shot }[] = [];
  let pumping = 0;
  const pump = () => {
    pumping = 0;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 12) {
      const job = queue.shift()!;
      let src = shots.get(job.key);
      if (!src) {
        src = thumbs.shot(job.look, job.kind);
        if (shots.size > 400) shots.clear();
        shots.set(job.key, src);
      }
      lastShot.set(job.slot, src);
      optsEl.querySelectorAll<HTMLImageElement>(`img[data-slot="${job.slot}"]`).forEach((img) => (img.src = src!));
    }
    if (queue.length) pumping = requestAnimationFrame(pump);
  };
  /** Grade de opções com miniatura e nome; `apply` diz como cada opção muda o visual. */
  const grid = <V extends string | boolean>(title: string, kind: Shot, values: readonly V[], names: Record<string, string>, current: V, apply: (v: V) => Partial<Look>) =>
    `<section><h4>${title}</h4><div class="ae-thumbs">${values.map((v) => {
      const next = { ...look, ...apply(v) }, key = `${kind}${JSON.stringify(next)}`, slot = `${title}:${v}`;
      const ready = shots.get(key);
      if (!ready) queue.push({ key, slot, look: next, kind });
      return `<button class="th${v === current ? ' on' : ''}" data-set='${esc(JSON.stringify(apply(v)))}' aria-pressed="${v === current}">
        <img data-slot="${esc(slot)}" src="${ready ?? lastShot.get(slot) ?? BLANK}" alt=""/><span>${esc(names[String(v)])}</span></button>`;
    }).join('')}</div></section>`;
  /** Paleta de cores, com a última bolinha para escolher qualquer cor. */
  const colors = (title: string, key: ColorKey, list: string[], note = '') => {
    const custom = !list.includes(look[key]);
    return `<section><h4>${title}${note ? ` <small>${note}</small>` : ''}</h4><div class="ae-sw">${list.map((c) =>
      `<button class="sw${look[key] === c ? ' on' : ''}" data-key="${key}" data-v="${c}" style="--c:${c}" aria-label="${title} ${c}"></button>`).join('')}
      <label class="sw custom${custom ? ' on' : ''}" style="--c:${custom ? look[key] : 'transparent'}" title="Outra cor">${custom ? '' : icon('plus')}<input type="color" data-key="${key}" value="${look[key]}"/></label></div></section>`;
  };

  function render() {
    host.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    const top = optsEl.scrollTop;
    queue = [];
    optsEl.innerHTML =
      tab === 'rosto' ? colors('Tom de pele', 'skin', SKIN_TONES)
        + grid('Expressão', 'head', FACES, FACE_NAMES, look.face, (face) => ({ face }))
        + grid('Barba e bigode', 'head', FACIAL, FACIAL_NAMES, look.facial, (facial) => ({ facial }))
      : tab === 'cabelo' ? grid('Penteado', 'head', HAIR_STYLES, HAIR_NAMES, look.hairStyle, (hairStyle) => ({ hairStyle }))
        + colors('Cor do cabelo', 'hair', HAIR_COLORS, 'vale também para barba e bigode')
      : tab === 'roupa' ? grid('Modelo', 'body', OUTFITS, OUTFIT_NAMES, look.outfit, (outfit) => ({ outfit }))
        + colors('Blusa', 'top', CLOTH_COLORS)
        + (hasDetail(look.outfit) ? colors('Detalhes', 'detail', CLOTH_COLORS, 'gravata, colar, suspensório, punhos') : '')
        + colors('Calça ou saia', 'bottom', CLOTH_COLORS)
        + colors('Sapatos', 'shoes', CLOTH_COLORS)
      : grid('Óculos', 'head', GLASSES, GLASSES_NAMES, look.glasses, (glasses) => ({ glasses }))
        + (look.glasses !== 'none' ? colors('Armação', 'frame', GEAR_COLORS) : '')
        + grid('Chapéu', 'head', HATS, HAT_NAMES, look.hat, (hat) => ({ hat }))
        + (look.hat !== 'none' ? colors('Cor do chapéu', 'hatColor', CLOTH_COLORS) : '')
        + grid('Fone de ouvido', 'head', [false, true], { false: 'Sem fone', true: 'Com fone' }, look.headphones, (headphones) => ({ headphones }))
        + (look.headphones ? colors('Cor do fone', 'phonesColor', GEAR_COLORS) : '')
        + grid('Brincos', 'head', [false, true], { false: 'Sem brincos', true: 'Com brincos' }, look.earrings, (earrings) => ({ earrings }))
        // fantasias só durante o Halloween (e somem do avatar quando o tema acaba)
        + (costumesActive() ? `<p class="ae-season">🎃 Fantasias de Halloween: valem até 6/11. Depois, o avatar volta ao normal sozinho.</p>`
          + grid('Fantasia', 'head', COSTUMES, COSTUME_NAMES, look.costume, (costume) => ({ costume }))
          + grid('Capa', 'body', [false, true], { false: 'Sem capa', true: 'Com capa' }, look.cape, (cape) => ({ cape }))
          + (look.cape ? colors('Cor da capa', 'capeColor', CAPE_COLORS) : '') : '');
    optsEl.scrollTop = top;
    if (!pumping && queue.length) pumping = requestAnimationFrame(pump);
  }

  const update = (patch: Partial<Look>, celebrate = false) => {
    look = { ...look, ...patch };
    render();
    rebuildPreview(celebrate);
  };

  const save = async () => {
    if (saving) return;
    saving = true;
    const button = $<HTMLButtonElement>('[data-save]');
    const label = button.textContent;
    const error = $<HTMLParagraphElement>('.ae-error');
    error.hidden = true;
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((el) => { el.disabled = true; });
    button.textContent = 'Salvando…';
    try {
      await onSave({ ...look });
      saving = false;
      close();
    } catch (e) {
      saving = false;
      host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((el) => { el.disabled = false; });
      button.textContent = label;
      error.textContent = e instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(e.name)
        ? e.message : 'Não foi possível salvar. Verifique sua conexão e tente novamente.';
      error.hidden = false;
    }
  };

  // fechar sem salvar só pergunta quando algo mudou; um clique fora não descarta mudanças
  const original = JSON.stringify(initial);
  const changed = () => JSON.stringify(look) !== original;
  const ask = (on: boolean) => {
    $<HTMLElement>('.ae-ask').hidden = !on;
    $<HTMLElement>('.ae-foot:not(.ae-ask)').hidden = on;
    if (on) $<HTMLButtonElement>('[data-keep]').focus();
  };
  const tryClose = () => (changed() ? ask(true) : close());
  host.addEventListener('click', (e) => {
    if (saving) return;
    const t = e.target as HTMLElement;
    if (t === host && !opts.welcome) return changed() ? undefined : close();
    if (t.closest('[data-close]')) return tryClose();
    if (t.closest('[data-keep]')) return ask(false);
    if (t.closest('[data-discard]')) return close();
    const tb = t.closest<HTMLElement>('[data-tab]');
    if (tb) { tab = tb.dataset.tab as Tab; optsEl.scrollTop = 0; render(); return; }
    const th = t.closest<HTMLElement>('[data-set]');
    if (th) return update(JSON.parse(th.dataset.set!), true);
    const sw = t.closest<HTMLElement>('button.sw');
    if (sw) return update({ [sw.dataset.key!]: sw.dataset.v! });
    if (t.closest('[data-random]')) return update(randomLook(), true);
    if (t.closest('[data-save]')) void save();
  });
  // cor livre: a prévia acompanha enquanto a pessoa arrasta no seletor
  host.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.type !== 'color') return;
    look = { ...look, [inp.dataset.key!]: inp.value };
    rebuildPreview();
  });
  host.addEventListener('change', (e) => { if ((e.target as HTMLInputElement).type === 'color') render(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || opts.welcome) return;
    if (!$<HTMLElement>('.ae-ask').hidden) ask(false); else tryClose();
  };
  addEventListener('keydown', onKey);

  function close() {
    if (saving) return;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(pumping);
    removeEventListener('keydown', onKey);
    if (model) disposeCharacter(model);
    thumbs.dispose();
    // devolve os contextos WebGL na hora (o navegador limita quantos ficam abertos)
    r.dispose();
    r.forceContextLoss();
    host.remove();
    document.body.classList.remove('modal-open');
  }

  render();
  rebuildPreview();
  loop();
  ($('[data-save]') as HTMLButtonElement).focus();
}
