import type { OfficeApp } from '../app';
import { api, type AdminData } from '../api';
import { icon } from './icons';
import { ago, esc } from './dom';

// Administração: integrantes (papel, mesa, acesso), convites de visitantes e nome do escritório.

export async function openAdmin(app: OfficeApp) {
  const host = document.createElement('div');
  host.className = 'modal-backdrop';
  document.body.appendChild(host);
  document.body.classList.add('modal-open');
  let tab: 'membros' | 'convites' | 'escritorio' = 'membros';
  let data: AdminData;

  const close = () => { host.remove(); document.body.classList.remove('modal-open'); };
  host.addEventListener('click', (e) => { if (e.target === host || (e.target as HTMLElement).closest('[data-close]')) close(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); removeEventListener('keydown', onKey); } };
  addEventListener('keydown', onKey);

  const load = async () => {
    try { data = await api.admin(); } catch (e) { app.notify.toast((e as Error).message); close(); return; }
    render();
  };

  const render = () => {
    const deskOpts = (current: number | null) => `<option value="">Sem mesa</option>${data.desks.map((d) => {
      const holder = data.members.find((m) => m.desk === d && m.active);
      return `<option value="${d}" ${current === d ? 'selected' : ''}>Mesa ${d + 1}${holder && holder.desk !== current ? ` · ${esc(holder.name)}` : ''}</option>`;
    }).join('')}`;
    const body = tab === 'membros'
      ? `<p class="muted">Contas Google do domínio entram automaticamente na primeira vez. Aqui você define papéis, mesas e remove acessos.</p>
         <table class="tbl"><thead><tr><th>Pessoa</th><th>Papel</th><th>Mesa</th><th>Acesso</th></tr></thead><tbody>${data.members.map((m) => `
          <tr class="${m.active ? '' : 'inactive'}"><td><b>${esc(m.name)}</b>${m.online ? ' <span class="chip on">online</span>' : ''}<small>${esc(m.email)}</small></td>
          <td><select data-role="${m.id}" ${m.active ? '' : 'disabled'}><option value="member" ${m.role === 'member' ? 'selected' : ''}>Integrante</option><option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Administração</option></select></td>
          <td><select data-desk="${m.id}" ${m.active ? '' : 'disabled'}>${deskOpts(m.desk)}</select></td>
          <td>${m.id === app.me ? '<small>Você</small>' : `<button class="btn soft" data-active="${m.id}" data-v="${m.active ? 0 : 1}">${m.active ? 'Remover acesso' : 'Devolver acesso'}</button>`}</td></tr>`).join('')}</tbody></table>`
      : tab === 'convites'
        ? `<p class="muted">Convites de visitantes gerados pela equipe. Revogar impede novas entradas com o link.</p>
           <table class="tbl"><thead><tr><th>Visitante</th><th>Convidado por</th><th>Validade</th><th></th></tr></thead><tbody>${data.invites.map((i) => {
          const expired = i.expiresAt < Date.now();
          return `<tr class="${i.revoked || expired ? 'inactive' : ''}"><td><b>${esc(i.name)}</b><small>Criado ${ago(i.createdAt)}</small></td><td>${esc(i.host)}</td><td>${i.revoked ? 'Revogado' : expired ? 'Expirado' : `Até ${new Date(i.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</td><td>${i.revoked || expired ? '' : `<button class="btn soft" data-revoke="${esc(i.token)}">Revogar</button>`}</td></tr>`;
        }).join('') || '<tr><td colspan="4" class="empty">Nenhum convite ainda.</td></tr>'}</tbody></table>`
        : `<label class="field"><span>Nome do escritório</span><input id="admName" maxlength="40" value="${esc(data.settings.officeName)}"/></label><button class="btn primary" id="admSave">Salvar</button>`;
    host.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="Administração">
      <div class="dh"><span class="dic">${icon('shield')}</span><div><b>Administração</b><small>${data.members.filter((m) => m.active).length} integrantes</small></div><button class="iconbtn" data-close aria-label="Fechar">${icon('x')}</button></div>
      <div class="tabs pad">${(['membros', 'convites', 'escritorio'] as const).map((t) => `<button class="tab${t === tab ? ' on' : ''}" data-tab="${t}">${{ membros: 'Integrantes', convites: 'Convites', escritorio: 'Escritório' }[t]}</button>`).join('')}</div>
      <div class="modal-body">${body}</div></div>`;
    host.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab as typeof tab; render(); }));
    const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { app.notify.toast((e as Error).message); } };
    host.querySelectorAll<HTMLSelectElement>('[data-role]').forEach((s) => s.addEventListener('change', () => act(() => api.adminMember({ id: s.dataset.role!, role: s.value }))));
    host.querySelectorAll<HTMLSelectElement>('[data-desk]').forEach((s) => s.addEventListener('change', () => act(() => api.adminMember({ id: s.dataset.desk!, desk: s.value === '' ? null : Number(s.value) }))));
    host.querySelectorAll<HTMLElement>('[data-active]').forEach((b) => b.addEventListener('click', () => {
      const on = b.dataset.v === '1';
      if (!on && !confirm('Remover o acesso desta pessoa? Ela sai do escritório na hora e não entra mais até o acesso ser devolvido.')) return;
      void act(() => api.adminMember({ id: b.dataset.active!, active: on }));
    }));
    host.querySelectorAll<HTMLElement>('[data-revoke]').forEach((b) => b.addEventListener('click', () => act(() => api.adminRevoke(b.dataset.revoke!))));
    host.querySelector('#admSave')?.addEventListener('click', () => act(async () => {
      await api.adminSettings({ officeName: host.querySelector<HTMLInputElement>('#admName')!.value.trim() });
      app.notify.toast('Nome salvo. Vale para quem entrar a partir de agora.');
    }));
  };

  await load();
}
