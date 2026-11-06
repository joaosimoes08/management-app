'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Check, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { useToast } from '@/components/ui/toast';

const roles = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'] as const;
type Mapping = { groupName: string; appRole: typeof roles[number] };
type DirectoryStatus = {
  configured: boolean; vendor: 'ad' | 'other'; connectionUrl: string; bindDn: string; usersDn: string;
  usernameLdapAttribute: string; groupsDn: string; groupNameLdapAttribute: string; groupObjectClass: string;
  membershipLdapAttribute: string; groupRoleMappings: Mapping[]; status: 'CONFIGURED' | 'NOT_CONFIGURED';
};
type DirectoryForm = Omit<DirectoryStatus, 'configured' | 'status' | 'groupRoleMappings'> & { bindCredential: string; groupRoleMappingsText: string };
const emptyForm: DirectoryForm = { vendor: 'other', connectionUrl: 'ldaps://ldap.example.org:636', bindDn: '', bindCredential: '', usersDn: '', usernameLdapAttribute: 'uid', groupsDn: '', groupNameLdapAttribute: 'cn', groupObjectClass: 'groupOfNames', membershipLdapAttribute: 'member', groupRoleMappingsText: '' };

export function DirectoryFederationSettings() {
  const [form, setForm] = useState<DirectoryForm>(emptyForm);
  const [status, setStatus] = useState<DirectoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const { error: toastError, success } = useToast();
  const load = async () => {
    setLoading(true);
    try {
      const current = await apiFetch<DirectoryStatus>('/api/v1/settings/directory-federation');
      setStatus(current);
      if (current.configured) setForm({ vendor: current.vendor, connectionUrl: current.connectionUrl, bindDn: current.bindDn, bindCredential: '', usersDn: current.usersDn, usernameLdapAttribute: current.usernameLdapAttribute, groupsDn: current.groupsDn, groupNameLdapAttribute: current.groupNameLdapAttribute, groupObjectClass: current.groupObjectClass, membershipLdapAttribute: current.membershipLdapAttribute, groupRoleMappingsText: current.groupRoleMappings.map((item) => `${item.groupName}=${item.appRole}`).join('\n') });
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Não foi possível consultar o Keycloak.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const payload = () => {
    const groupRoleMappings = form.groupRoleMappingsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const split = line.lastIndexOf('=');
      if (split < 1) throw new Error(`Mapeamento inválido: “${line}”. Usa nome-do-grupo=ROLE.`);
      const groupName = line.slice(0, split).trim(); const appRole = line.slice(split + 1).trim();
      if (!roles.includes(appRole as typeof roles[number])) throw new Error(`Role inválida no mapeamento “${line}”.`);
      return { groupName, appRole };
    });
    return { vendor: form.vendor, connectionUrl: form.connectionUrl.trim(), bindDn: form.bindDn.trim(), bindCredential: form.bindCredential, usersDn: form.usersDn.trim(), usernameLdapAttribute: form.usernameLdapAttribute, groupsDn: form.groupsDn.trim(), groupNameLdapAttribute: form.groupNameLdapAttribute, groupObjectClass: form.groupObjectClass, membershipLdapAttribute: form.membershipLdapAttribute, groupRoleMappings };
  };
  const run = async (event: Pick<FormEvent, 'preventDefault'>, mode: 'test' | 'save') => {
    event.preventDefault(); setSaving(true); setFeedback('');
    try {
      const body = payload();
      if (mode === 'test') { const result = await apiFetch<{ message: string }>('/api/v1/settings/directory-federation/test', { method: 'POST', body: JSON.stringify(body) }); setFeedback(result.message); success('Federação de diretório', 'Ligação LDAPS testada'); }
      else { await apiFetch('/api/v1/settings/directory-federation', { method: 'PUT', body: JSON.stringify(body) }); setForm((current) => ({ ...current, bindCredential: '' })); setFeedback('Configuração guardada no Keycloak. O segredo não é devolvido pela aplicação.'); success('Federação de diretório', 'Configuração guardada'); await load(); }
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Não foi possível concluir a operação.'; setFeedback(message); toastError('Federação de diretório', message); }
    finally { setSaving(false); }
  };
  const set = (key: keyof DirectoryForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <section className="ipam-card settings-panel">
    <div className="panel-heading"><div><span className="section-kicker">KEYCLOAK · LDAPS</span><h2>Federação de diretório</h2><p className="panel-description">O Keycloak valida as credenciais LDAP e guarda o segredo. A aplicação não recebe nem armazena palavras-passe LDAP.</p></div><ShieldCheck size={19}/></div>
    <div className="integration-row"><span><strong>Estado da federação</strong><small>{loading ? 'A consultar Keycloak…' : status?.configured ? 'Configurada no Keycloak · ligação não testada nesta sessão' : 'Não configurada'}</small></span><button type="button" className="secondary-button" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={14}/>Atualizar</button></div>
    {feedback && <div className="ipam-alert">{feedback}</div>}
    <form className="settings-form" onSubmit={(event) => void run(event, 'save')}>
      <label>Endereço LDAPS<input required type="url" pattern="ldaps://.+" placeholder="ldaps://ldap.example.org:636" value={form.connectionUrl} onChange={(event) => set('connectionUrl', event.target.value)}/><small>Usa LDAPS com certificado confiável pelo Keycloak; LDAP sem TLS não é aceite.</small></label>
      <div className="form-row"><label>Bind DN<input required value={form.bindDn} onChange={(event) => set('bindDn', event.target.value)}/></label><label>Credencial de serviço<input required type="password" autoComplete="new-password" value={form.bindCredential} onChange={(event) => set('bindCredential', event.target.value)}/><small>Introduz novamente ao testar ou guardar. O segredo só é enviado ao Keycloak e nunca é devolvido.</small></label></div>
      <label>Base de utilizadores (DN)<input required value={form.usersDn} onChange={(event) => set('usersDn', event.target.value)}/></label>
      <label>Tipo de diretório<select value={form.vendor} onChange={(event) => { set('vendor', event.target.value); if (event.target.value === 'ad') setForm((current) => ({ ...current, vendor: 'ad', usernameLdapAttribute: 'sAMAccountName', groupNameLdapAttribute: 'cn', groupObjectClass: 'group', membershipLdapAttribute: 'member' })); else setForm((current) => ({ ...current, vendor: 'other', usernameLdapAttribute: 'uid', groupNameLdapAttribute: 'cn', groupObjectClass: 'groupOfNames', membershipLdapAttribute: 'member' })); }}><option value="other">OpenLDAP / outro</option><option value="ad">Microsoft Active Directory</option></select></label>
      <label>Atributo de utilizador<select value={form.usernameLdapAttribute} onChange={(event) => set('usernameLdapAttribute', event.target.value)}><option value="uid">uid</option><option value="cn">cn</option><option value="sAMAccountName">sAMAccountName</option><option value="userPrincipalName">userPrincipalName</option></select></label>
      <label>Base de grupos (DN)<input required value={form.groupsDn} onChange={(event) => set('groupsDn', event.target.value)}/></label>
      <div className="form-row"><label>Atributo do nome do grupo<select value={form.groupNameLdapAttribute} onChange={(event) => set('groupNameLdapAttribute', event.target.value)}><option value="cn">cn</option><option value="sAMAccountName">sAMAccountName</option></select></label><label>Object class do grupo<select value={form.groupObjectClass} onChange={(event) => set('groupObjectClass', event.target.value)}><option value="groupOfNames">groupOfNames</option><option value="groupOfUniqueNames">groupOfUniqueNames</option><option value="group">group (AD)</option></select></label></div>
      <label>Atributo de associação<select value={form.membershipLdapAttribute} onChange={(event) => set('membershipLdapAttribute', event.target.value)}><option value="member">member (DN)</option><option value="uniqueMember">uniqueMember (DN)</option><option value="memberUid">memberUid (UID)</option></select></label>
      <label>Grupos para roles<textarea rows={5} value={form.groupRoleMappingsText} onChange={(event) => set('groupRoleMappingsText', event.target.value)} placeholder={'network-admins=ADMIN\nnetops=NETWORK_OPERATOR'} /><small>Uma linha por mapeamento: nome exato do grupo LDAP=role da aplicação. O mesmo grupo pode ter várias roles. Os grupos têm de estar sincronizados no Keycloak antes de guardar.</small></label>
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={saving || !form.bindCredential} onClick={(event) => void run(event, 'test')}><ShieldCheck size={14}/>Testar LDAPS</button><button className="primary-button" disabled={saving || loading || !form.bindCredential}><Check size={14}/>{saving ? 'A guardar…' : 'Guardar no Keycloak'}</button></div>
    </form>
  </section>;
}
