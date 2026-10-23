import * as THREE from 'three';
import { characterModel } from '../avatar';
import type { Person } from '../people';

/** Renderiza o rosto de cada personagem, para usar na lista e nos cartões de vídeo. */
export function renderPortraits(people: Person[]) {
  const size = 128;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b7a991', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(1.5, 2, 2.5);
  scene.add(key);
  const cam = new THREE.OrthographicCamera(-0.3, 0.3, 0.3, -0.3, 0.1, 10);
  cam.position.set(0.55, 0.62, 1.6);
  cam.lookAt(0, 0.56, 0);

  const out: Record<string, string> = {};
  for (const p of people) {
    const { model, animations } = characterModel(p);
    const mixer = new THREE.AnimationMixer(model);
    const idle = animations.find((a) => a.name === 'idle');
    if (idle) { mixer.clipAction(idle).play(); mixer.update(0.1); }
    scene.add(model);
    r.render(scene, cam);
    out[p.id] = r.domElement.toDataURL('image/png');
    scene.remove(model);
  }
  r.dispose();
  return out;
}
