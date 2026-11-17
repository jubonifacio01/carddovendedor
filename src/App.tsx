import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, ArrowDownToLine, CalendarDays, Check, ChevronRight,
  CircleHelp, ClipboardList, CloudOff, FileSpreadsheet, History, Minus, Plus,
  Settings2, ShieldCheck, Smartphone, Target, Trash2, Truck, X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { deleteEntry, loadState, replaceState, saveEntry, saveProfile } from './lib/api';
import { exportBackup, exportMonthlyReport } from './lib/excel';
import { calculateRates, sumEntries } from './lib/calculations';
import {
  DEFAULT_TARGETS, EMPTY_ENTRY, SERVICE_LABELS,
  type AppState, type DailyEntry, type Profile, type Targets,
} from './types';

 type EntryField = keyof typeof SERVICE_LABELS;
 type Tab = 'entry' | 'history' | 'report';

const todayISO = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const monthISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
};
const formatShortDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(year, month - 1, day));
};
const formatMonth = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, number - 1, 1));
};
const formatPercent = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 }).format(value);
const emptyProfile = (): Profile => ({ name: '', agency: '', targets: { ...DEFAULT_TARGETS } });

function App() {
  const [appState, setAppState] = useState<AppState>({ profile: null, entries: [] });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('entry');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [draft, setDraft] = useState<DailyEntry>(EMPTY_ENTRY(todayISO()));
  const [draftDirty, setDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileDraft, setProfileDraft] = useState<Profile>(emptyProfile());
  const [profileModal, setProfileModal] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(monthISO());
  const [reportMonth, setReportMonth] = useState(monthISO());
  const [notice, setNotice] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadState()
      .then((loadedState) => {
        if (!active) return;
        setAppState(loadedState);
        if (!loadedState.profile) {
          setProfileDraft(emptyProfile());
          setProfileModal(true);
        }
        setLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        setNotice(`Não foi possível abrir os dados locais: ${String(error)}`);
        setLoaded(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const existing = appState.entries.find((entry) => entry.date === selectedDate);
    setDraft(existing ? { ...existing } : EMPTY_ENTRY(selectedDate));
    setDraftDirty(false);
  }, [selectedDate, appState.entries]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!draftDirty || !appState.profile) return;
    setSaving(true);
    const snapshot: DailyEntry = { ...draft, date: selectedDate, updatedAt: new Date().toISOString() };
    const timeout = window.setTimeout(async () => {
      try {
        await saveEntry(snapshot);
        setAppState((current) => ({
          ...current,
          entries: [...current.entries.filter((entry) => entry.date !== selectedDate), snapshot]
            .sort((a, b) => b.date.localeCompare(a.date)),
        }));
        setDraftDirty(false);
        setSaving(false);
      } catch (error) {
        setDraftDirty(false);
        setSaving(false);
        setNotice(`Falha no salvamento automático: ${String(error)}`);
      }
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [draft, draftDirty, selectedDate, appState.profile]);

  const orderedEntries = useMemo(
    () => [...appState.entries].sort((a, b) => b.date.localeCompare(a.date)),
    [appState.entries],
  );
  const historyEntries = orderedEntries.filter((entry) => entry.date.startsWith(historyMonth));
  const reportEntries = useMemo(
    () => appState.entries.filter((entry) => entry.date.startsWith(reportMonth)).sort((a, b) => a.date.localeCompare(b.date)),
    [appState.entries, reportMonth],
  );
  const monthlyTotals = useMemo(() => sumEntries(reportEntries), [reportEntries]);
  const monthlyRates = useMemo(() => calculateRates(monthlyTotals), [monthlyTotals]);
  const monthlyEncomendas = monthlyTotals.pac + monthlyTotals.sedex;

  const notify = (message: string) => setNotice(message);

  const updateValue = (field: EntryField, value: number) => {
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setDraft((current) => ({ ...current, [field]: safeValue, updatedAt: new Date().toISOString() }));
    setDraftDirty(true);
  };

  const persistEntry = async () => {
    if (!appState.profile) {
      setProfileDraft(emptyProfile());
      setProfileModal(true);
      return;
    }
    const entryToSave = { ...draft, date: selectedDate, updatedAt: new Date().toISOString() };
    try {
      await saveEntry(entryToSave);
      setAppState((current) => ({
        ...current,
        entries: [...current.entries.filter((entry) => entry.date !== selectedDate), entryToSave]
          .sort((a, b) => b.date.localeCompare(a.date)),
      }));
      setDraftDirty(false);
      setSaving(false);
      notify('Lançamento salvo neste computador.');
    } catch (error) {
      notify(`Erro ao salvar: ${String(error)}`);
    }
  };

  const removeEntry = async (date: string) => {
    const confirmed = window.confirm(`Excluir o lançamento de ${formatDate(date)}?`);
    if (!confirmed) return;
    try {
      await deleteEntry(date);
      setAppState((current) => ({ ...current, entries: current.entries.filter((entry) => entry.date !== date) }));
      notify('Lançamento excluído.');
    } catch (error) {
      notify(`Não foi possível excluir: ${String(error)}`);
    }
  };

  const openProfile = () => {
    setProfileDraft(appState.profile ? {
      ...appState.profile,
      targets: { ...appState.profile.targets },
    } : emptyProfile());
    setProfileModal(true);
  };

  const persistProfile = async () => {
    const cleanProfile: Profile = {
      ...profileDraft,
      name: profileDraft.name.trim(),
      agency: profileDraft.agency.trim(),
    };
    if (!cleanProfile.name) {
      notify('Informe o nome do atendente.');
      return;
    }
    try {
      await saveProfile(cleanProfile);
      setAppState((current) => ({ ...current, profile: cleanProfile }));
      setProfileModal(false);
      notify('Identificação e metas salvas.');
    } catch (error) {
      notify(`Erro ao salvar o perfil: ${String(error)}`);
    }
  };

  const handleBackupRestore = async (file?: File) => {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text()) as AppState & { app?: string; backupVersion?: number };
      if (backup.app !== 'Card do Vendedor' || !Array.isArray(backup.entries)) {
        throw new Error('O arquivo selecionado não é um backup válido do Card do Vendedor.');
      }
      if (!window.confirm('A restauração substituirá os dados atuais deste computador. Deseja continuar?')) return;
      const restored: AppState = { profile: backup.profile ?? null, entries: backup.entries };
      await replaceState(restored);
      setAppState(restored);
      if (restored.profile) setProfileModal(false);
      else setProfileModal(true);
      notify('Backup restaurado.');
    } catch (error) {
      notify(`Não foi possível restaurar o backup: ${String(error)}`);
    } finally {
      if (backupInput.current) backupInput.current.value = '';
    }
  };

  const hideWindow = async () => {
    if (!isTauri()) return;
    try { await getCurrentWindow().hide(); } catch { /* janela de prévia */ }
  };

  const saveMonthly = async () => {
    if (!appState.profile) return;
    try {
      const saved = await exportMonthlyReport(appState.profile, appState.entries, reportMonth);
      notify(saved ? 'Relatório mensal salvo no local escolhido.' : 'Exportação cancelada.');
    } catch (error) {
      notify(`Falha ao gerar o Excel: ${String(error)}`);
    }
  };

  const saveBackup = async () => {
    try {
      const saved = await exportBackup(appState);
      notify(saved ? 'Backup salvo no local escolhido.' : 'Backup não foi salvo.');
    } catch (error) {
      notify(`Falha ao salvar backup: ${String(error)}`);
    }
  };

  if (!loaded) {
    return <main className="loading-shell"><div className="brand-mark"><Truck size={24} /></div><span>Preparando seu Card do Vendedor…</span></main>;
  }

  return (
    <main className="app-shell">
      <header className="window-header" data-tauri-drag-region>
        <div className="brand-mark"><Truck size={19} strokeWidth={2.2} /></div>
        <div className="brand-title" data-tauri-drag-region>
          <strong>Card do Vendedor</strong>
          <span>Registro diário · Correios</span>
        </div>
        <div className="header-actions">
          <button className="icon-button" title="Identificação e metas" onClick={openProfile}><Settings2 size={17} /></button>
          <button className="icon-button close-button" title="Ocultar na bandeja" onClick={hideWindow}><X size={17} /></button>
        </div>
      </header>

      <section className="profile-strip">
        <div className="avatar">{appState.profile?.name?.slice(0, 1).toLocaleUpperCase('pt-BR') || 'A'}</div>
        <div className="profile-info">
          <strong>{appState.profile?.name || 'Configure seu perfil'}</strong>
          <span>{appState.profile?.agency || 'Agência não informada'}</span>
        </div>
        <div className="local-status"><span className="status-dot" /> Local</div>
      </section>

      <nav className="tabs" aria-label="Navegação principal">
        <button className={tab === 'entry' ? 'tab active' : 'tab'} onClick={() => setTab('entry')}><Plus size={15} /> Lançar</button>
        <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}><History size={15} /> Histórico</button>
        <button className={tab === 'report' ? 'tab active' : 'tab'} onClick={() => setTab('report')}><FileSpreadsheet size={15} /> Relatório</button>
      </nav>

      <div className="content-area">
        {tab === 'entry' && (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">APONTAMENTO DIÁRIO</p>
                <h1>Lançamentos</h1>
                <p className="section-subtitle">Registre as quantidades realizadas no dia.</p>
              </div>
              <div className="date-control">
                <CalendarDays size={15} />
                <input aria-label="Data do lançamento" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
              </div>
            </div>

            <div className="service-grid">
              {(Object.keys(SERVICE_LABELS) as EntryField[]).map((field) => {
                const isCellular = field === 'cellular';
                const dailyRates = calculateRates(draft);
                const rate = field === 'sedex'
                  ? dailyRates.sedex
                  : field === 'premium' || field === 'vd' || field === 'ar' || field === 'packaging'
                    ? dailyRates[field]
                    : null;
                const descriptor = field === 'pac'
                  ? 'Base de encomendas'
                  : field === 'cellular'
                    ? 'Quantidade vendida no dia'
                    : `Participação: ${formatPercent(rate ?? 0)}`;
                return (
                  <article className={`service-card ${isCellular ? 'cellular-card' : ''} ${field === 'pac' ? 'base-card' : ''}`} key={field}>
                    <div className="service-title-row">
                      <span className={`service-symbol symbol-${field}`}>{field === 'cellular' ? <Smartphone size={16} /> : field === 'pac' || field === 'sedex' ? <Truck size={16} /> : <Archive size={16} />}</span>
                      <div className="service-title">
                        <strong>{SERVICE_LABELS[field]}</strong>
                        <span>{descriptor}</span>
                      </div>
                    </div>
                    <div className="counter-row">
                      <button className="counter-button" aria-label={`Diminuir ${SERVICE_LABELS[field]}`} onClick={() => updateValue(field, draft[field] - 1)} disabled={draft[field] <= 0}><Minus size={16} /></button>
                      <input
                        className="count-input"
                        aria-label={`Quantidade ${SERVICE_LABELS[field]}`}
                        type="number"
                        min="0"
                        step="1"
                        value={draft[field]}
                        onChange={(event) => updateValue(field, Number(event.target.value))}
                      />
                      <button className="counter-button plus" aria-label={`Aumentar ${SERVICE_LABELS[field]}`} onClick={() => updateValue(field, draft[field] + 1)}><Plus size={16} /></button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="calculation-note">
              <Activity size={15} />
              <span>Os percentuais são calculados automaticamente com as mesmas bases do modelo original.</span>
            </div>
            <button className="primary-button save-button" onClick={persistEntry}><Check size={17} /> Salvar lançamento do dia</button>
            <div className="save-hint"><ShieldCheck size={13} /> {saving ? 'Salvando alterações…' : draftDirty ? 'Alteração pendente de salvamento…' : 'Salvo automaticamente neste computador.'}</div>
          </>
        )}

        {tab === 'history' && (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">CONSULTA E EDIÇÃO</p>
                <h1>Histórico</h1>
                <p className="section-subtitle">Reabra um dia para corrigir os números.</p>
              </div>
            </div>
            <label className="month-filter"><CalendarDays size={15} /><span>Mês</span><input type="month" value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)} /></label>
            <div className="history-summary"><strong>{historyEntries.length}</strong><span>{historyEntries.length === 1 ? 'dia lançado' : 'dias lançados'} em {formatMonth(historyMonth)}</span></div>
            {historyEntries.length === 0 ? (
              <div className="empty-state"><ClipboardList size={29} /><strong>Nenhum lançamento neste mês</strong><span>Os dias salvos aparecerão aqui.</span></div>
            ) : (
              <div className="history-list">
                {historyEntries.map((entry) => (
                  <article className="history-row" key={entry.date}>
                    <div className="history-date"><strong>{formatShortDate(entry.date)}</strong><span>{formatDate(entry.date).split(' de ').slice(1).join(' de ')}</span></div>
                    <div className="history-numbers"><strong>{entry.pac + entry.sedex}</strong><span>encomendas</span></div>
                    <div className="history-mini"><span>AR {entry.ar}</span><span>VD {entry.vd}</span><span>Cel. {entry.cellular}</span></div>
                    <button className="row-action" title="Editar este dia" onClick={() => { setSelectedDate(entry.date); setTab('entry'); }}><ChevronRight size={17} /></button>
                    <button className="row-delete" title="Excluir lançamento" onClick={() => removeEntry(entry.date)}><Trash2 size={15} /></button>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'report' && (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">FECHAMENTO MENSAL</p>
                <h1>Relatório</h1>
                <p className="section-subtitle">Consolide os registros para enviar no fim do mês.</p>
              </div>
            </div>
            <label className="month-filter"><CalendarDays size={15} /><span>Referência</span><input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} /></label>
            <div className="report-hero">
              <div>
                <span className="hero-label">Encomendas no mês</span>
                <strong>{monthlyEncomendas.toLocaleString('pt-BR')}</strong>
                <span className="hero-foot">PAC + SEDEX</span>
              </div>
              <div className="hero-side">
                <span><b>{reportEntries.length}</b> dias lançados</span>
                <span><b>{monthlyTotals.cellular}</b> Correios Celular</span>
              </div>
            </div>

            <div className="summary-heading"><h2>Resultado por indicador</h2><span>{formatMonth(reportMonth)}</span></div>
            <div className="metric-list">
              {[
                { label: 'PAC', quantity: monthlyTotals.pac, rate: null, target: null },
                { label: 'SEDEX', quantity: monthlyTotals.sedex, rate: monthlyRates.sedex, target: appState.profile?.targets.sedex },
                { label: 'Premium 10 e 12', quantity: monthlyTotals.premium, rate: monthlyRates.premium, target: appState.profile?.targets.premium },
                { label: 'VD', quantity: monthlyTotals.vd, rate: monthlyRates.vd, target: appState.profile?.targets.vd },
                { label: 'AR', quantity: monthlyTotals.ar, rate: monthlyRates.ar, target: appState.profile?.targets.ar },
                { label: 'Embalagem', quantity: monthlyTotals.packaging, rate: monthlyRates.packaging, target: appState.profile?.targets.packaging },
                { label: 'Correios Celular', quantity: monthlyTotals.cellular, rate: null, target: null },
              ].map((metric) => {
                const achieved = metric.rate !== null && metric.target !== undefined && metric.target !== null && metric.rate >= metric.target;
                return (
                  <div className="metric-row" key={metric.label}>
                    <div className="metric-label"><strong>{metric.label}</strong>{metric.rate !== null && <span>{formatPercent(metric.rate)} do indicador</span>}</div>
                    <div className="metric-value"><strong>{metric.quantity}</strong>{metric.target !== null && metric.target !== undefined && <span className={achieved ? 'goal-hit' : 'goal-miss'}>{achieved ? 'Meta atingida' : `Meta ${formatPercent(metric.target)}`}</span>}</div>
                  </div>
                );
              })}
            </div>

            <div className="report-note"><CircleHelp size={15} /><span>O consolidado soma as quantidades do mês e recalcula os percentuais sobre as mesmas bases do modelo semanal.</span></div>
            <button className="primary-button export-button" onClick={saveMonthly} disabled={reportEntries.length === 0}><ArrowDownToLine size={17} /> Exportar Excel mensal</button>
            {reportEntries.length === 0 && <p className="disabled-hint">Faça ao menos um lançamento no mês selecionado para liberar a exportação.</p>}
          </>
        )}
      </div>

      <footer className="app-footer">
        <span><CloudOff size={13} /> Funciona sem internet</span>
        <button onClick={openProfile}><Target size={13} /> Metas e perfil</button>
      </footer>

      {notice && <div className="toast" role="status">{notice}</div>}

      {profileModal && (
        <div className="modal-backdrop">
          <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="modal-heading">
              <div className="brand-mark modal-brand"><Settings2 size={18} /></div>
              <div><p className="eyebrow">CONFIGURAÇÃO INICIAL</p><h2 id="profile-title">Identificação e metas</h2></div>
              {appState.profile && <button className="icon-button modal-close" onClick={() => setProfileModal(false)} title="Fechar"><X size={17} /></button>}
            </div>
            <p className="modal-description">Esses dados identificam o relatório mensal deste atendente.</p>
            <label className="form-field"><span>Nome do atendente</span><input autoFocus value={profileDraft.name} onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nome e sobrenome" /></label>
            <label className="form-field"><span>Agência</span><input value={profileDraft.agency} onChange={(event) => setProfileDraft((current) => ({ ...current, agency: event.target.value }))} placeholder="Nome ou código da agência" /></label>
            <div className="goal-section">
              <div className="goal-heading"><strong>Metas do modelo</strong><span>Podem ser ajustadas</span></div>
              <div className="goal-grid">
                {([
                  ['sedex', 'SEDEX'], ['premium', 'Premium 10 e 12'], ['vd', 'VD'], ['ar', 'AR'], ['packaging', 'Embalagem'],
                ] as [keyof Targets, string][]).map(([key, label]) => (
                  <label className="goal-field" key={key}><span>{label}</span><div><input type="number" min="0" step="0.01" value={(profileDraft.targets[key] * 100).toString()} onChange={(event) => setProfileDraft((current) => ({ ...current, targets: { ...current.targets, [key]: Math.max(0, Number(event.target.value) || 0) / 100 } }))} /><small>%</small></div></label>
                ))}
              </div>
              <p className="goal-footnote">Valores iniciais extraídos da coluna META do arquivo enviado. PAC não possui meta numérica no modelo.</p>
            </div>
            <button className="primary-button modal-save" onClick={persistProfile}><Check size={16} /> Salvar configuração</button>
            <div className="backup-tools">
              <button onClick={saveBackup}><ArrowDownToLine size={14} /> Exportar backup dos dados</button>
              <button onClick={() => backupInput.current?.click()}><Archive size={14} /> Restaurar backup</button>
              <input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={(event) => handleBackupRestore(event.target.files?.[0])} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
