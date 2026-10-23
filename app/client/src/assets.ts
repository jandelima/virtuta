import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, GLTF>();
const base = import.meta.env.BASE_URL;

export const furnitureUrl = (name: string) => `${base}models/furniture/${name}.glb`;
export const characterUrl = (name: string) => `${base}models/characters/${name}.glb`;

/** Carrega todos os modelos de uma vez, informando o progresso. */
export async function preload(urls: string[], onProgress: (done: number, total: number) => void) {
  let done = 0;
  await Promise.all(
    urls.map(async (url) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      cache.set(url, gltf);
      onProgress(++done, urls.length);
    }),
  );
}

export function gltf(url: string): GLTF {
  const g = cache.get(url);
  if (!g) throw new Error(`Modelo não carregado: ${url}`);
  return g;
}

export const furniture = (name: string) => gltf(furnitureUrl(name)).scene;
