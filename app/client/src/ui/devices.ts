import type { OfficeApp } from '../app';
import type { Panels } from './panels';
import { icon } from './icons';
import { esc } from './dom';

// Escolha e teste de microfone, câmera e saída de som.

export async function devicesPanel(app: OfficeApp, panels: Panels) {
  const media = app.media;
  let stream: MediaStream | null = null;
  let raf = 0;
  let ctx: AudioContext | null = null;
  const stop = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx?.close();
    ctx = null;
  };

  const render = async () => {
    let list: Awaited<ReturnType<typeof media.devices>>;
    try { list = await media.devices(); } catch { list = { audioinput: [], videoinput: [], audiooutput: [] }; }
    const needPermission = [...list.audioinput, ...list.videoinput].every((d) => !d.label);
    const sel = (kind: 'audioinput' | 'videoinput' | 'audiooutput', label: string) => {
      const opts = list[kind];
      if (!opts.length) return `<label class="field"><span>${label}</span><select disabled><option>${kind === 'audiooutput' ? 'Padrão do sistema' : 'Nenhum encontrado'}</option></select></label>`;
      return `<label class="field"><span>${label}</span><select data-kind="${kind}">${opts.map((d) => `<option value="${esc(d.deviceId)}" ${media.prefs[kind] === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Dispositivo sem nome')}</option>`).join('')}</select></label>`;
    };
    panels.show(`<div class="dh"><span class="dic">${icon('settings')}</span><div><b>Microfone, câmera e som</b><small>Tudo começa desligado ao entrar</small></div><button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="db2">
        ${needPermission ? `<p class="hint-box">${icon('lock')}Para listar e testar os dispositivos, o navegador precisa de permissão.</p><button class="btn primary wide" id="devAllow">Permitir acesso</button>` : ''}
        ${sel('audioinput', 'Microfone')}
        <div class="meter"><i id="devLevel"></i></div>
        ${sel('videoinput', 'Câmera')}
        <div class="cam-test"><video id="devVideo" autoplay muted playsinline></video><span id="devCamOff">${icon('camOff')}Prévia desligada</span></div>
        ${sel('audiooutput', 'Saída de som')}
        <div class="row"><button class="btn soft" id="devTest">${icon('cam')}Testar câmera e microfone</button><button class="btn soft" id="devSound">${icon('volume')}Tocar som de teste</button></div>
        <p class="muted">Entrar numa conversa nunca liga o microfone ou a câmera: só você liga, pelo dock ou pelas teclas M e V.</p>
      </div>`, (d) => {
      panels.onLeave(stop);
      d.querySelector('#devAllow')?.addEventListener('click', async () => {
        try { (await navigator.mediaDevices.getUserMedia({ audio: true, video: true })).getTracks().forEach((t) => t.stop()); } catch { app.notify.toast('O navegador não liberou o acesso.'); }
        void render();
      });
      d.querySelectorAll<HTMLSelectElement>('select[data-kind]').forEach((s) => s.addEventListener('change', async () => {
        await media.setDevice(s.dataset.kind as 'audioinput' | 'videoinput' | 'audiooutput', s.value);
        if (stream) void test(d);
      }));
      d.querySelector('#devTest')!.addEventListener('click', () => (stream ? (stop(), resetPreview(d)) : void test(d)));
      d.querySelector('#devSound')!.addEventListener('click', () => void beep());
    });
  };

  const resetPreview = (d: HTMLElement) => {
    d.querySelector<HTMLVideoElement>('#devVideo')!.srcObject = null;
    d.querySelector<HTMLElement>('#devCamOff')!.hidden = false;
    d.querySelector<HTMLElement>('#devLevel')!.style.width = '0%';
  };

  const test = async (d: HTMLElement) => {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: media.prefs.audioinput ? { deviceId: { exact: media.prefs.audioinput } } : true,
        video: media.prefs.videoinput ? { deviceId: { exact: media.prefs.videoinput } } : true,
      });
    } catch (e) {
      app.notify.mediaError(e, 'câmera');
      return;
    }
    const v = d.querySelector<HTMLVideoElement>('#devVideo')!;
    v.srcObject = stream;
    d.querySelector<HTMLElement>('#devCamOff')!.hidden = true;
    ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const bar = d.querySelector<HTMLElement>('#devLevel')!;
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
      bar.style.width = `${Math.min(100, (peak / 90) * 100)}%`;
      raf = requestAnimationFrame(loop);
    };
    loop();
  };

  const beep = async () => {
    const a = new Audio();
    const c = new AudioContext();
    const dest = c.createMediaStreamDestination();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = 660;
    g.gain.value = 0.15;
    o.connect(g).connect(dest);
    a.srcObject = dest.stream;
    const sink = (a as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (sink && media.prefs.audiooutput) await sink.call(a, media.prefs.audiooutput).catch(() => {});
    o.start();
    await a.play();
    setTimeout(() => { o.stop(); void c.close(); }, 600);
  };

  await render();
}
