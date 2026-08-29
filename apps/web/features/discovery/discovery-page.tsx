'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Play, RefreshCw, Search, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { createDiscoveryJob, getDiscoveryDefaults, listDiscoveryJobs, listDiscoveryResults, listDiscoverySubnets, reviewDiscoveryResult, type DiscoveryJob, type DiscoveryJobPayload } from './api';

export default function DiscoveryPage(){
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');
  const [siteId, setSiteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: 'Discovery manual', subnetId: '', methods: ['ICMP', 'TCP'], tcpPorts: '22,80,443,3389', reverseDns: true });
  const [selectedJob, setSelectedJob] = useState('');

  const { data: jobsData, refetch: refetchJobs } = useQuery({ queryKey: ['discovery', 'jobs'], queryFn: listDiscoveryJobs });
  const { data: subnetsData } = useQuery({ queryKey: ['discovery', 'subnets', siteId], queryFn: () => listDiscoverySubnets(siteId), enabled: Boolean(siteId) });
  const { data: defaultsData } = useQuery({ queryKey: ['discovery', 'defaults'], queryFn: getDiscoveryDefaults });
  const { data: results = [] } = useQuery({ queryKey: ['discovery', 'results', selectedJob], queryFn: () => listDiscoveryResults(selectedJob), enabled: Boolean(selectedJob) });

  const jobs = jobsData?.items ?? [];
  const subnets = subnetsData?.items ?? [];

  const load = async () => {
    setBusy(true);
    try { await Promise.all([refetchJobs(), queryClient.invalidateQueries({ queryKey: ['discovery', 'subnets'] })]); }
    finally { setBusy(false); }
  };

  // Bootstrap: resolve the active site and honor the ?action=new deep link.
  useEffect(() => {
    const siteId = new URLSearchParams(window.location.search).get('siteId') || window.localStorage.getItem('cociber.siteId') || '';
    setSiteId(siteId);
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') setModal(true);
  }, []);

  // Seed the form from discovery defaults (same behavior as the original load()).
  useEffect(() => {
    if (!defaultsData || !subnetsData) return;
    setForm((current) => ({
      ...current,
      methods: defaultsData.methods,
      tcpPorts: defaultsData.tcpPorts.join(','),
      reverseDns: defaultsData.reverseDns,
      ...(!current.subnetId && subnets[0] ? { subnetId: subnets[0].id } : {}),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsData, subnetsData]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const payload: DiscoveryJobPayload = { name: form.name, subnetId: form.subnetId, methods: form.methods, tcpPorts: form.tcpPorts.split(',').map(Number).filter(Boolean) };
    try { await createDiscoveryJob(payload); setModal(false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a execução.'); }
  };
  const open = (job: DiscoveryJob) => { setSelectedJob(job.id); };
  const review = async (result: { id: string }, status: 'APPROVED' | 'IGNORED') => {
    try {
      await reviewDiscoveryResult(result.id, status);
      queryClient.setQueryData(['discovery', 'results', selectedJob], (current: { id: string; status: string }[] | undefined) => (current ?? []).map((item) => (item.id === result.id ? { ...item, status } : item)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível rever o resultado.'); }
  };
  const normalized = search.trim().toLowerCase(); const visibleJobs = normalized ? jobs.filter((job) => `${job.name} ${job.status} ${job.subnet.cidr} ${job.subnet.site?.name ?? ''}`.toLowerCase().includes(normalized)) : jobs;
  return <AppShell section="Descoberta" search={{ value: search, onChange: setSearch, placeholder: 'Pesquisar execuções…' }} actions={<><button className="topbar-action secondary-button" onClick={() => void load()}><RefreshCw size={14} className={busy ? 'spin' : ''} /> Atualizar</button>{canEdit && <button className="topbar-action primary-button" onClick={() => setModal(true)}><Play size={14} /> Nova descoberta</button>}</>}><main className="module-page discovery-workspace"><header className="workspace-head"><div><span className="section-kicker">HOST DISCOVERY</span><h1>Descoberta</h1></div></header>{error && <div className="ipam-alert error"><X size={15} />{error}</div>}<div className="summary-stats"><div><strong>{jobs.filter((j) => j.status === 'RUNNING').length}</strong><span>Em execução</span></div><div><strong>{jobs.reduce((n, j) => n + j._count.results, 0)}</strong><span>Resultados alcançáveis</span></div><div><strong>{jobs.reduce((n, j) => n + (j.unreachableCount ?? 0), 0)}</strong><span>Sem resposta</span></div></div><section className="ipam-card"><div className="panel-heading"><div><span className="section-kicker">HISTÓRICO</span><h2>Execuções recentes</h2></div></div>{visibleJobs.map((job) => <button className="job-row" key={job.id} onClick={() => open(job)}><span className={`job-status ${job.status.toLowerCase()}`} /><span><strong>{job.name}</strong><small>{job.subnet.cidr} · {job.subnet.site?.name ?? 'sem site'} · {job._count.results} resultados · {job.reachableCount ?? 0} alcançáveis · {job.status}</small></span><ChevronRight size={15} /></button>)}{!visibleJobs.length && <div className="empty-context"><Search size={22} /><strong>{search ? 'Sem execuções correspondentes' : 'Ainda não existem descobertas'}</strong><span>{search ? 'Experimenta outra pesquisa.' : 'Executa a primeira análise de uma subnet.'}</span></div>}</section>{selectedJob && <section className="ipam-card"><div className="panel-heading"><div><span className="section-kicker">REVISÃO MANUAL</span><h2>Resultados alcançáveis</h2></div></div>{results.map((result) => <div className="result-row" key={result.id}><span><strong>{result.address}</strong><small>{result.hostname || 'reverse DNS não encontrado'} · {result.icmpReachable ? `ICMP ${result.responseMs ?? ''}ms` : 'TCP alcançável'}{result.openPorts?.length ? ` · TCP ${result.openPorts.join(', ')}` : ''}</small></span>{result.status === 'PENDING' && canEdit ? <span className="result-actions"><button className="secondary-button" onClick={() => void review(result, 'APPROVED')}><Check size={13} /> Aprovar</button><button className="danger-button" onClick={() => void review(result, 'IGNORED')}><X size={13} /> Ignorar</button></span> : <em>{result.status}</em>}</div>)}{!results.length && <div className="no-data">Não existem resultados alcançáveis para esta execução.</div>}</section>}{modal && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true"><div className="modal-heading"><div><span className="section-kicker">NOVA EXECUÇÃO</span><h2>Executar discovery</h2></div><button className="icon-button subtle" onClick={() => setModal(false)} aria-label="Fechar"><X size={16} /></button></div><form className="modal-form" onSubmit={create}><label>Nome<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Subnet<select required value={form.subnetId} onChange={(event) => setForm({ ...form, subnetId: event.target.value })}>{subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.cidr}</option>)}</select></label><div className="method-checks"><button type="button" className={form.methods.includes('ICMP') ? 'method active' : 'method'} onClick={() => setForm((current) => ({ ...current, methods: current.methods.includes('ICMP') ? current.methods.filter((method) => method !== 'ICMP') : [...current.methods, 'ICMP'] }))}>ICMP</button><button type="button" className={form.methods.includes('TCP') ? 'method active' : 'method'} onClick={() => setForm((current) => ({ ...current, methods: current.methods.includes('TCP') ? current.methods.filter((method) => method !== 'TCP') : [...current.methods, 'TCP'] }))}>TCP</button></div>{form.methods.includes('TCP') && <label>Portas TCP<input value={form.tcpPorts} onChange={(event) => setForm({ ...form, tcpPorts: event.target.value })} /></label>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancelar</button><button className="primary-button" disabled={!form.methods.length || !form.subnetId}><Play size={14} /> Executar</button></div></form></section></div>}</main></AppShell>;
}
