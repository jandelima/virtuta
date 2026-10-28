import './style.css';
import { api, type MeResponse } from './api';
import { characterUrl, furnitureUrl, preload } from './assets';
import { ALL_MODELS } from './look';
import { OfficeApp } from './app';
import { icon } from './ui/icons';
import { esc } from './ui/dom';

// Entrada: login (Google do domínio), convite de visitante ou o escritório.

/** Móveis usados na planta (só estes são baixados). */
const FURNITURE = [
  'desk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'kitchenCabinet', 'books', 'plantSmall2', 'pottedPlant',
  'table', 'rugDoormat', 'coatRackStanding', 'kitchenSink', 'kitchenFridgeLarge', 'kitchenCoffeeMachine', 'kitchenMicrowave',
  'tableRound', 'chair', 'radio', 'tableCoffeeSquare', 'benchCushionLow',
];

const $ = (id: string) => document.getElementById(id)!;

const ERRORS: Record<string, string> = {
  dominio: 'Use a conta Google da empresa para entrar.',
  google: 'O Google não confirmou o login. Tente de novo.',
  sessao: 'A tentativa de login expirou. Tente de novo.',
  removido: 'Seu acesso foi removido pela administração.',
};

function card(html: string) {
  $('loading').classList.add('done');
  const el = $('gate');
  el.innerHTML = `<div class="gate-card"><svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" class="logo-bg" /><path d="M7 8l5 9 5-9" class="logo-v" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>${html}</div>`;
  el.hidden = false;
  return el;
}

function loginScreen(me: MeResponse) {
  const err = new URLSearchParams(location.search).get('erro');
  const c = me.config;
  const el = card(`<h1>${esc(c.officeName)}</h1><p>O escritório virtual da equipe.</p>
    ${err ? `<p class="err">${esc(ERRORS[err] ?? 'Não foi possível entrar.')}</p>` : ''}
    ${c.googleEnabled ? `<a class="btn google" href="/api/auth/google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Entrar com Google</a><small class="muted">Somente contas ${c.domain ? `@${esc(c.domain)}` : 'da empresa'}</small>` : ''}
    ${c.devLogin ? `<form id="dev" class="dev"><span class="chip">Modo de desenvolvimento</span><input id="devName" maxlength="40" placeholder="Seu nome" required/><button class="btn primary" type="submit">Entrar</button></form>` : ''}
    ${!c.googleEnabled && !c.devLogin ? '<p class="err">O acesso ao escritório está sendo preparado. Entre em contato com a administração.</p>' : ''}`);
  el.querySelector('#dev')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (el.querySelector('#devName') as HTMLInputElement).value.trim();
    if (!name) return;
    await api.devLogin(name);
    location.href = '/';
  });
}

async function inviteScreen(token: string) {
  const info = await api.inviteInfo(token).catch(() => null);
  if (!info || info.error) {
    card(`<h1>Convite indisponível</h1><p>Este convite expirou ou foi revogado. Peça um novo link a quem convidou você.</p>`);
    return;
  }
  const el = card(`<h1>${esc(info.officeName)}</h1><p>${esc(info.host)} convidou você para o escritório virtual da equipe. Você entra pela recepção e é admitido em seguida.</p>
    <form id="inv" class="dev"><input id="invName" maxlength="40" value="${esc(info.name)}" placeholder="Seu nome" required/><button class="btn primary" type="submit">${icon('door')}Entrar como visitante</button></form>
    <small class="muted">Válido até ${new Date(info.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}. Microfone e câmera começam desligados.</small>`);
  el.querySelector('#inv')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.joinInvite(token, (el.querySelector('#invName') as HTMLInputElement).value.trim());
      location.href = '/';
    } catch (err) {
      card(`<h1>Convite indisponível</h1><p>${esc((err as Error).message)}</p>`);
    }
  });
}

async function openOffice(role: 'member' | 'admin' | 'guest') {
  const urls = [...FURNITURE.map(furnitureUrl), ...ALL_MODELS.map((m) => characterUrl(`character-${m}`))];
  await preload(urls, (d, t) => {
    $('loadbar').style.width = `${(d / t) * 100}%`;
    $('loadtxt').textContent = `Carregando o escritório · ${Math.round((d / t) * 100)}%`;
  });
  await document.fonts.ready;
  $('app').hidden = false;
  const app = new OfficeApp(role);
  try { if (localStorage.getItem('virtuta.theme') === 'night') app.sc.applyTheme('night'); } catch { /* tema padrão */ }
  app.start();
  // usado nos testes automatizados
  Object.assign(window, { __app: app });
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  const me = await api.me();
  const invite = qs.get('convite');
  if (!me.user) return invite ? inviteScreen(invite) : loginScreen(me);
  if (invite || qs.has('erro')) history.replaceState(null, '', '/');
  await openOffice(me.user.role);
}

boot().catch((e) => {
  console.error(e);
  $('loadtxt').textContent = `Não foi possível abrir o escritório: ${(e as Error).message}`;
});
