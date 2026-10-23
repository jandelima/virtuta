import * as THREE from 'three';

// Texturas procedurais dos pisos. Cada textura cobre 2x2 unidades do mundo.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function grain(g: CanvasRenderingContext2D, size: number, alpha: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < size * 6; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(0,0,0,${alpha * r()})` : `rgba(255,255,255,${alpha * r()})`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1);
  }
}

export function planks(colors: string[], line: string, seed = 1, rows = 12) {
  const { c, g } = makeCanvas();
  const r = rng(seed);
  const rh = 512 / rows;
  for (let y = 0; y < rows; y++) {
    let x = -r() * 300;
    while (x < 512) {
      const len = 180 + r() * 260;
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.fillRect(x, y * rh, len, rh);
      // veios
      g.strokeStyle = 'rgba(0,0,0,0.035)';
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        const yy = y * rh + 4 + r() * (rh - 8);
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 6, x + len * 0.6, yy + (r() - 0.5) * 6, x + len, yy);
        g.stroke();
      }
      g.fillStyle = line;
      g.fillRect(x, y * rh, 1.5, rh);
      x += len;
    }
    g.fillStyle = line;
    g.fillRect(0, y * rh, 512, 1.5);
  }
  grain(g, 512, 0.05, seed + 7);
  return finish(c);
}

export function carpet(base: string, speck: string, seed = 2) {
  const { c, g } = makeCanvas(256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = speck;
    g.globalAlpha = 0.08 + r() * 0.12;
    g.fillRect(r() * 256, r() * 256, 1, 1);
  }
  g.globalAlpha = 1;
  return finish(c);
}

export function tiles(a: string, b: string, line: string, n = 8) {
  const { c, g } = makeCanvas();
  const s = 512 / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? a : b;
      g.fillRect(x * s, y * s, s, s);
    }
  g.strokeStyle = line;
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke();
  }
  grain(g, 512, 0.04, 11);
  return finish(c);
}

export function concrete(base: string, seed = 3) {
  const { c, g } = makeCanvas();
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  const r = rng(seed);
  for (let i = 0; i < 60; i++) {
    const x = r() * 512, y = r() * 512, rad = 30 + r() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() > 0.5;
    gr.addColorStop(0, dark ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  grain(g, 512, 0.05, seed + 3);
  // juntas de dilatação
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, 0, 512, 1.5);
  g.fillRect(0, 0, 1.5, 512);
  return finish(c);
}

export function deck(colors: string[], gap: string, seed = 5) {
  const { c, g } = makeCanvas();
  g.fillStyle = gap;
  g.fillRect(0, 0, 512, 512);
  const r = rng(seed);
  const rows = 8, rh = 512 / rows;
  for (let y = 0; y < rows; y++) {
    let x = -r() * 200;
    while (x < 512) {
      const len = 260 + r() * 200;
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.fillRect(x + 2, y * rh + 3, len - 4, rh - 6);
      x += len;
    }
  }
  grain(g, 512, 0.06, seed + 1);
  return finish(c);
}

/** Textura com texto e desenhos para quadros, telas e placas. */
export function drawn(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
