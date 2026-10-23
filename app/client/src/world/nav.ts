import * as THREE from 'three';

/** Grade de navegação com A* e suavização por linha de visada. */
export class NavGrid {
  readonly cell = 0.2;
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(readonly minX: number, readonly minZ: number, readonly maxX: number, readonly maxZ: number) {
    this.cols = Math.ceil((maxX - minX) / this.cell);
    this.rows = Math.ceil((maxZ - minZ) / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  private ci(x: number) { return Math.floor((x - this.minX) / this.cell); }
  private ri(z: number) { return Math.floor((z - this.minZ) / this.cell); }
  private cx(c: number) { return this.minX + (c + 0.5) * this.cell; }
  private rz(r: number) { return this.minZ + (r + 0.5) * this.cell; }

  setRect(x1: number, z1: number, x2: number, z2: number, value: 0 | 1) {
    const c1 = Math.max(0, this.ci(Math.min(x1, x2))), c2 = Math.min(this.cols - 1, this.ci(Math.max(x1, x2)));
    const r1 = Math.max(0, this.ri(Math.min(z1, z2))), r2 = Math.min(this.rows - 1, this.ri(Math.max(z1, z2)));
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) this.blocked[r * this.cols + c] = value;
  }

  block(x1: number, z1: number, x2: number, z2: number) { this.setRect(x1, z1, x2, z2, 1); }
  open(x1: number, z1: number, x2: number, z2: number) { this.setRect(x1, z1, x2, z2, 0); }

  private free(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && !this.blocked[r * this.cols + c];
  }

  walkable(x: number, z: number) { return this.free(this.ci(x), this.ri(z)); }

  nearestWalkable(x: number, z: number): THREE.Vector2 | null {
    const c0 = this.ci(x), r0 = this.ri(z);
    for (let rad = 0; rad < 30; rad++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let r = r0 - rad; r <= r0 + rad; r++)
        for (let c = c0 - rad; c <= c0 + rad; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad || !this.free(c, r)) continue;
          const d = (c - c0) ** 2 + (r - r0) ** 2;
          if (d < bd) { bd = d; best = [c, r]; }
        }
      if (best) return new THREE.Vector2(this.cx(best[0]), this.rz(best[1]));
    }
    return null;
  }

  lineFree(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(fx: number, fz: number, tx: number, tz: number): THREE.Vector3[] | null {
    const start = this.walkable(fx, fz) ? new THREE.Vector2(fx, fz) : this.nearestWalkable(fx, fz);
    const goal = this.walkable(tx, tz) ? new THREE.Vector2(tx, tz) : this.nearestWalkable(tx, tz);
    if (!start || !goal) return null;
    if (this.lineFree(start.x, start.y, goal.x, goal.y)) return [new THREE.Vector3(goal.x, 0, goal.y)];

    const W = this.cols, N = W * this.rows;
    const sc = this.ci(start.x), sr = this.ri(start.y), gc = this.ci(goal.x), gr = this.ri(goal.y);
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const h = (c: number, r: number) => { const dx = Math.abs(c - gc), dy = Math.abs(r - gr); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const s = sr * W + sc, goalI = gr * W + gc;
    g[s] = 0;
    push(h(sc, sr), s);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (i === goalI) { found = true; break; }
      closed[i] = 1;
      const c = i % W, r = (i / W) | 0;
      for (const [dc, dr, cost] of dirs) {
        const nc = c + dc, nr = r + dr;
        if (!this.free(nc, nr)) continue;
        if (dc && dr && (!this.free(c + dc, r) || !this.free(c, r + dr))) continue;
        const ni = nr * W + nc, ng = g[i] + cost;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = i; push(ng + h(nc, nr), ni); }
      }
    }
    if (!found) return null;

    const cells: THREE.Vector2[] = [];
    for (let i = goalI; i !== -1; i = came[i]) cells.push(new THREE.Vector2(this.cx(i % W), this.rz((i / W) | 0)));
    cells.reverse();
    cells[cells.length - 1] = goal;

    // suavização: pula pontos enquanto houver linha de visada livre
    const out: THREE.Vector3[] = [];
    let anchor = start;
    let k = 0;
    while (k < cells.length - 1) {
      let far = k + 1;
      for (let j = cells.length - 1; j > k; j--) {
        if (this.lineFree(anchor.x, anchor.y, cells[j].x, cells[j].y)) { far = j; break; }
      }
      out.push(new THREE.Vector3(cells[far].x, 0, cells[far].y));
      anchor = cells[far];
      k = far;
    }
    return out;
  }
}
