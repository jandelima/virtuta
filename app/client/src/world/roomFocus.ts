import * as THREE from 'three';
import type { Space, Zone } from './space';
import { areaAt } from '../../../shared/layout';

// Destaque da sala atual: no shader, o que fica fora dela tem a luz baixada.
// Guarda o retângulo anterior e o atual para a troca de sala ser um cruzamento suave.

const MARGIN = 0.12; // cobre a espessura das paredes na divisa
const uniforms = {
  uRoomA: { value: new THREE.Vector4(-1e3, -1e3, 1e3, 1e3) },
  uRoomB: { value: new THREE.Vector4(-1e3, -1e3, 1e3, 1e3) },
  uMix: { value: 1 },
  uBg: { value: new THREE.Color('#e2e5e9') },
  // fora da sala: quanto perde de cor, quanto escurece e quanto se funde ao fundo
  uDesat: { value: 0.25 },
  uDark: { value: 0.45 },
  uFade: { value: 0 },
};
let current: Zone | null = null;

function patch(mat: THREE.Material) {
  if (mat.userData.dimPatched) return;
  mat.userData.dimPatched = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vDimPos;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDimPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `varying vec3 vDimPos;
uniform vec4 uRoomA, uRoomB;
uniform float uMix;
uniform vec3 uBg;
uniform float uDesat, uDark, uFade;
float dimInside(vec4 r) {
  vec2 a = smoothstep(r.xy - 0.04, r.xy + 0.04, vDimPos.xz);
  vec2 b = 1.0 - smoothstep(r.zw - 0.04, r.zw + 0.04, vDimPos.xz);
  return a.x * a.y * b.x * b.y;
}
void main() {`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
float dimIn = mix(dimInside(uRoomA), dimInside(uRoomB), uMix);
vec3 dimGrey = vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)));
vec3 dimOut = mix(mix(gl_FragColor.rgb, dimGrey, uDesat) * (1.0 - uDark), uBg, uFade);
gl_FragColor.rgb = mix(dimOut, gl_FragColor.rgb, dimIn);`);
  };
  mat.customProgramCacheKey = () => 'dim';
  mat.needsUpdate = true;
}

/** Aplica o efeito a todos os materiais do espaço, exceto os marcados com `userData.noDim`. */
export function enableRoomFocus(root: THREE.Object3D) {
  const walk = (o: THREE.Object3D) => {
    if (o.userData.noDim) return;
    const m = (o as THREE.Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach(patch);
    o.children.forEach(walk);
  };
  walk(root);
}

/** Intensidade do efeito fora da sala (0 desliga). */
export function setFocusStyle(o: { desat: number; dark: number; fade: number }) {
  uniforms.uDesat.value = o.desat;
  uniforms.uDark.value = o.dark;
  uniforms.uFade.value = o.fade;
}

/** Cor do fundo, para acompanhar o tema. */
export function setFocusColors(background: THREE.Color) {
  uniforms.uBg.value.copy(background);
}

const EVERYTHING = new THREE.Vector4(-1e3, -1e3, 1e3, 1e3);

/** Sala que deve ficar em destaque para quem está em (x, z); no salão aberto, nenhuma. */
export function setFocusRoom(sp: Space, x: number, z: number) {
  const area = areaAt(x, z);
  const zone = area?.kind === 'room' ? sp.zones.find((q) => q.id === area.id) ?? null : null;
  if (zone === current) return;
  // continua de onde a transição anterior parou
  const shown = uniforms.uMix.value < 0.5 ? uniforms.uRoomA.value.clone() : uniforms.uRoomB.value.clone();
  uniforms.uRoomA.value.copy(shown);
  if (zone) uniforms.uRoomB.value.set(zone.x1 - MARGIN, zone.z1 - MARGIN, zone.x2 + MARGIN, zone.z2 + MARGIN);
  else uniforms.uRoomB.value.copy(EVERYTHING);
  uniforms.uMix.value = 0;
  current = zone;
}

export function updateRoomFocus(dt: number) {
  uniforms.uMix.value = Math.min(1, uniforms.uMix.value + dt * 2.5);
}

export function focusedRoom() { return current; }
