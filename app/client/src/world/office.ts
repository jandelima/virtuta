import * as THREE from 'three';
import { FACE, FS, Space, type Facing } from './space';

/** Altura inicial do quadril em cada tipo de assento; a final é medida no estofado do modelo (Space.finalize). */
export const SEAT_Y = { chairDesk: 0.33, chair: 0.28, sofa: 0.2, beanbag: 0.12 };

export const floorMat = (map: THREE.Texture, roughness = 0.82) => new THREE.MeshStandardMaterial({ map, roughness });

export function plant(sp: Space, x: number, z: number, kind = 'pottedPlant', s = FS) {
  sp.model(kind, x, z, { s, pad: 0.15 });
}

export function chairAt(sp: Space, id: string, x: number, z: number, face: Facing, model = 'chairModernCushion') {
  const { obj } = sp.model(model, x, z, { rot: FACE[face], pad: 0.06 });
  sp.seat(id, x, z, face, SEAT_Y.chair);
  sp.sittable(obj, id);
}
