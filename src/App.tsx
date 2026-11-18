import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Activity, Archive, ArrowDownToLine, CalendarDays, Check, ChevronRight,
  CircleHelp, ClipboardList, CloudOff, FileSpreadsheet, History, Maximize2,
  Minimize2, Minus, Plus, Settings2, ShieldCheck, Smartphone, Target,
  Trash2, Truck, X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { deleteEntry, loadState, replaceState, saveEntry, saveMonthlyProduct, saveProfile } from './lib/api';
import { exportBackup, exportMonthlyReport } from './lib/excel';
import { calculateRates, sumEntries } from './lib/calculations';
import {
  DEFAULT_TARGETS, DEFAULT_MONTHLY_PRODUCT_NAME, EMPTY_ENTRY, SERVICE_LABELS,
  type AppState, type DailyEntry, type EntryField, type MonthlyProduct, type Profile, type Targets,
} from './types';

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
const emptyMonthlyProduct = (month: string): MonthlyProduct => ({ month, name: DEFAULT_MONTHLY_PRODUCT_NAME, target: 0 });

function App() {
  const [appState, setAppState] = useState<AppState>({ profile: null, entries: [], monthlyProducts: [] });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('entry');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [systemDate, setSystemDate] = useState(todayISO());
  const lastTodayRef = useRef(todayISO());
  const draftRevisionRef = useRef(0);
  const shouldFollowTodayRef = useRef(true);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [draft, setDraft] = useState<DailyEntry>(EMPTY_ENTRY(todayISO()));
  const [draftDirty, setDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileDraft, setProfileDraft] = useState<Profile>(emptyProfile());
  const [profileModal, setProfileModal] = useState(false);
  const [campaignDraft, setCampaignDraft] = useState<MonthlyProduct>(emptyMonthlyProduct(monthISO()));
  const [campaignModal, setCampaignModal] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(monthISO());
  const [reportMonth, setReportMonth] = useState(monthISO());
  const [notice, setNotice] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);

  // Mantém a data corrente sincronizada mesmo quando o painel fica aberto durante a virada do dia.
  // Se o usuário selecionou manualmente uma data antiga, não sobrescreve essa escolha.
  useEffect(() => {
    const refreshSystemDate = () => {
      const nextToday = todayISO();
      const previousToday = lastTodayRef.current;
      if (nextToday === previousToday) return;

      lastTodayRef.current = nextToday;
      setSystemDate(nextToday);
      setHistoryMonth((current) => current === previousToday.slice(0, 7) ? nextToday.slice(0, 7) : current);
      setReportMonth((current) => current === previousToday.slice(0, 7) ? nextToday.slice(0, 7) : current);
    };

    const intervalId = window.setInterval(refreshSystemDate, 15_000);
    window.addEventListener('focus', refreshSystemDate);
    document.addEventListener('visibilitychange', refreshSystemDate);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshSystemDate);
      document.removeEventListener('visibilitychange', refreshSystemDate);
    };
  }, []);

  // Se havia alteração em andamento na virada do dia, espera o salvamento automático
  // terminar antes de trocar para o novo dia.
  useEffect(() => {
    if (shouldFollowTodayRef.current && !draftDirty && selectedDate !== systemDate) {
      setSelectedDate(systemDate);
    }
  }, [systemDate, draftDirty, selectedDate]);

  // Acompanha o estado da janela para alternar o ícone de maximizar/restaurar.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    getCurrentWindow().isMaximized().then((value) => {
      if (!cancelled) setWindowMaximized(value);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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
  }, [selectedDate, loaded]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!draftDirty || !appState.profile) return;
    setSaving(true);
    const revision = draftRevisionRef.current;
    const snapshot: DailyEntry = { ...draft, date: selectedDate, updatedAt: new Date().toISOString() };
    const timeout = window.setTimeout(async () => {
      try {
        await saveEntry(snapshot);
        setAppState((current) => ({
          ...current,
          entries: [...current.entries.filter((entry) => entry.date !== selectedDate), snapshot]
            .sort((a, b) => b.date.localeCompare(a.date)),
        }));
        if (draftRevisionRef.current === revision) setDraftDirty(false);
        setSaving(false);
      } catch (error) {
        if (draftRevisionRef.current === revision) setDraftDirty(false);
        setSaving(false);
        setNotice(`Falha no salvamento automático: ${String(error)}`);
      }
    }, 220);
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
  const selectedMonth = selectedDate.slice(0, 7);
  const selectedMonthlyProduct = appState.monthlyProducts.find((product) => product.month === selectedMonth) ?? emptyMonthlyProduct(selectedMonth);
  const reportMonthlyProduct = appState.monthlyProducts.find((product) => product.month === reportMonth) ?? emptyMonthlyProduct(reportMonth);
  const selectedProductTotal = appState.entries.filter((entry) => entry.date.startsWith(selectedMonth)).reduce((sum, entry) => sum + entry.monthlyProductQty, 0);
  const selectedProductProgress = selectedMonthlyProduct.target > 0 ? Math.min(100, selectedProductTotal / selectedMonthlyProduct.target * 100) : 0;

  const notify = (message: string) => setNotice(message);

  const updateValue = (field: EntryField, value: number) => {
    draftRevisionRef.current += 1;
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setDraft((current) => ({ ...current, [field]: safeValue, updatedAt: new Date().toISOString() }));
    setDraftDirty(true);
  };


  const removeEntry = async (date: string) => {
    const confirmed = window.confirm(`Excluir o lançamento de ${formatDate(date)}?`);
    if (!confirmed) return;
    try {
      await deleteEntry(date);
      setAppState((current) => ({ ...current, entries: current.entries.filter((entry) => entry.date !== date) }));
      if (date === selectedDate) { draftRevisionRef.current += 1; setDraft(EMPTY_ENTRY(date)); setDraftDirty(false); }
      notify('Lançamento excluído.');
    } catch (error) {
      notify(`Não foi possível excluir: ${String(error)}`);
    }
  };

  const openCampaignSettings = (month = selectedMonth) => {
    const existing = appState.monthlyProducts.find((product) => product.month === month);
    setCampaignDraft(existing ? { ...existing } : emptyMonthlyProduct(month));
    setCampaignModal(true);
  };

  const persistCampaignSettings = async () => {
    const cleanProduct: MonthlyProduct = {
      month: campaignDraft.month,
      name: campaignDraft.name.trim(),
      target: Math.max(0, Math.floor(Number(campaignDraft.target) || 0)),
    };
    if (!cleanProduct.name) {
      notify('Informe o nome do produto sazonal.');
      return;
    }
    try {
      await saveMonthlyProduct(cleanProduct);
      setAppState((current) => ({
        ...current,
        monthlyProducts: [...current.monthlyProducts.filter((product) => product.month !== cleanProduct.month), cleanProduct]
          .sort((a, b) => b.month.localeCompare(a.month)),
      }));
      setCampaignModal(false);
      notify(`Produto de ${formatMonth(cleanProduct.month)} atualizado.`);
    } catch (error) {
      notify(`Não foi possível salvar o produto sazonal: ${String(error)}`);
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
      const restored: AppState = { profile: backup.profile ?? null, entries: backup.entries.map((entry: DailyEntry & { cellular?: number }) => ({ ...entry, monthlyProductQty: entry.monthlyProductQty ?? entry.cellular ?? 0 })), monthlyProducts: Array.isArray(backup.monthlyProducts) ? backup.monthlyProducts : [] };
      await replaceState(restored);
      setAppState(restored);
      draftRevisionRef.current += 1;
      setDraft(restored.entries.find((entry) => entry.date === selectedDate) ?? EMPTY_ENTRY(selectedDate));
      setDraftDirty(false);
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
    try { await getCurrentWindow().hide(); } catch { /* prévia no navegador */ }
  };

  const minimizeWindow = async () => {
    if (!isTauri()) return;
    try { await getCurrentWindow().minimize(); } catch { /* prévia no navegador */ }
  };

  const toggleWindowSize = async () => {
    if (!isTauri()) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setWindowMaximized((current) => !current);
    } catch { /* prévia no navegador */ }
  };

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (!isTauri() || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a')) return;
    void getCurrentWindow().startDragging();
  };

  const saveMonthly = async () => {
    if (!appState.profile) return;
    try {
      const saved = await exportMonthlyReport(appState.profile, appState.entries, reportMonth, reportMonthlyProduct);
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
    <main className={`app-shell ${windowMaximized ? 'is-maximized' : ''}`}>

      <header
        className="window-header"
        onMouseDown={startWindowDrag}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) void toggleWindowSize();
        }}
      >
        <div className="brand-mark"><Truck size={19} strokeWidth={2.2} /></div>
        <div className="brand-title">
          <strong>Card do Vendedor</strong>
          <span>Painel rápido · Correios</span>
        </div>
        <div className="header-actions">
          <button className="window-control settings-control" title="Identificação e metas" onClick={openProfile}><Settings2 size={17} /></button>
          <button className="window-control" title="Minimizar janela" onClick={minimizeWindow}><Minus size={17} /></button>
          <button className="window-control" title={windowMaximized ? 'Restaurar janela' : 'Maximizar janela'} onClick={toggleWindowSize}>{windowMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="window-control close-button" title="Ocultar na bandeja" onClick={hideWindow}><X size={17} /></button>
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
                <CalendarDays size={17} />
                <input aria-label="Data do lançamento" type="date" value={selectedDate} onChange={(event) => { shouldFollowTodayRef.current = event.target.value === systemDate; setSelectedDate(event.target.value); }} />
                <button type="button" className={selectedDate === systemDate ? 'today-button today-active' : 'today-button'} onClick={() => { shouldFollowTodayRef.current = true; setSelectedDate(systemDate); }} title="Ir para a data de hoje">Hoje</button>
              </div>
            </div>

            <section className="campaign-config-strip">
              <div className="campaign-config-copy">
                <span className="campaign-kicker">PRODUTO SAZONAL · {formatMonth(selectedMonth)}</span>
                <strong>{selectedMonthlyProduct.name}</strong>
                <span>Meta: {selectedMonthlyProduct.target > 0 ? `${selectedMonthlyProduct.target} unidades` : 'não definida'} · Registrado: {selectedProductTotal} unidades</span>
                {selectedMonthlyProduct.target > 0 && <div className="campaign-progress" aria-label={`${Math.round(selectedProductProgress)}% da meta alcançada`}><span style={{ width: `${selectedProductProgress}%` }} /></div>}
              </div>
              <button className="campaign-edit-button" onClick={() => openCampaignSettings(selectedMonth)}><Settings2 size={16} /> Alterar</button>
            </section>

            <div className="service-grid">
              {([...Object.keys(SERVICE_LABELS), 'monthlyProductQty'] as EntryField[]).map((field) => {
                const isMonthlyProduct = field === 'monthlyProductQty';
                const fieldLabel = isMonthlyProduct ? selectedMonthlyProduct.name : SERVICE_LABELS[field as keyof typeof SERVICE_LABELS];
                const dailyRates = calculateRates(draft);
                const rate = field === 'sedex'
                  ? dailyRates.sedex
                  : field === 'premium' || field === 'vd' || field === 'ar' || field === 'packaging'
                    ? dailyRates[field]
                    : null;
                const descriptor = field === 'pac'
                  ? 'Base de encomendas'
                  : isMonthlyProduct
                    ? `Produto do mês · ${selectedMonthlyProduct.target > 0 ? `Meta ${selectedMonthlyProduct.target} un.` : 'Meta não definida'}`
                    : `Participação: ${formatPercent(rate ?? 0)}`;
                return (
                  <article className={`service-card ${isMonthlyProduct ? 'cellular-card campaign-service-card' : ''} ${field === 'pac' ? 'base-card' : ''}`} key={field}>
                    <div className="service-title-row">
                      <span className={`service-symbol symbol-${isMonthlyProduct ? 'cellular' : field}`}>{isMonthlyProduct ? <Smartphone size={16} /> : field === 'pac' || field === 'sedex' ? <Truck size={16} /> : <Archive size={16} />}</span>
                      <div className="service-title">
                        <strong>{fieldLabel}</strong>
                        <span>{descriptor}</span>
                      </div>
                    </div>
                    <div className="counter-row">
                      <button className="counter-button" aria-label={`Diminuir ${fieldLabel}`} onClick={() => updateValue(field, draft[field] - 1)} disabled={draft[field] <= 0}><Minus size={16} /></button>
                      <input
                        className="count-input"
                        aria-label={`Quantidade ${fieldLabel}`}
                        type="number"
                        min="0"
                        step="1"
                        value={draft[field]}
                        onChange={(event) => updateValue(field, Number(event.target.value))}
                      />
                      <button className="counter-button plus quick-add" aria-label={`Registrar mais um: ${fieldLabel}`} onClick={() => updateValue(field, draft[field] + 1)}><Plus size={16} /><span>+1</span></button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="calculation-note">
              <Activity size={16} />
              <span><strong>Um toque = um lançamento.</strong> Use +1 a cada postagem ou produto vendido. O aplicativo salva automaticamente; use o número para corrigir uma quantidade.</span>
            </div>
            <div className="save-hint"><ShieldCheck size={14} /> {saving || draftDirty ? 'Salvando…' : 'Tudo salvo automaticamente neste computador.'}</div>
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
                    <div className="history-mini"><span>AR {entry.ar}</span><span>VD {entry.vd}</span><span>{(appState.monthlyProducts.find((product) => product.month === entry.date.slice(0, 7))?.name ?? DEFAULT_MONTHLY_PRODUCT_NAME).slice(0, 10)} {entry.monthlyProductQty}</span></div>
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
            <button className="campaign-edit-button report-campaign-edit" onClick={() => openCampaignSettings(reportMonth)}><Settings2 size={15} /> Configurar produto e meta deste mês</button>
            <div className="report-hero">
              <div>
                <span className="hero-label">Encomendas no mês</span>
                <strong>{monthlyEncomendas.toLocaleString('pt-BR')}</strong>
                <span className="hero-foot">PAC + SEDEX</span>
              </div>
              <div className="hero-side">
                <span><b>{reportEntries.length}</b> dias lançados</span>
                <span><b>{monthlyTotals.monthlyProductQty}</b> {reportMonthlyProduct.name}</span>
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
                { label: reportMonthlyProduct.name, quantity: monthlyTotals.monthlyProductQty, rate: null, target: reportMonthlyProduct.target },
              ].map((metric) => {
                const achieved = metric.rate !== null && metric.target !== undefined && metric.target !== null && metric.rate >= metric.target;
                return (
                  <div className="metric-row" key={metric.label}>
                    <div className="metric-label"><strong>{metric.label}</strong>{metric.rate !== null && <span>{formatPercent(metric.rate)} do indicador</span>}</div>
                    <div className="metric-value"><strong>{metric.quantity}</strong>{metric.target !== null && metric.target !== undefined && <span className={metric.rate === null ? (metric.target > 0 ? (metric.quantity >= metric.target ? 'goal-hit' : 'goal-miss') : 'goal-neutral') : (achieved ? 'goal-hit' : 'goal-miss')}>{metric.rate === null ? (metric.target > 0 ? (metric.quantity >= metric.target ? 'Meta atingida' : `Meta ${metric.target} un.`) : 'Meta não definida') : (achieved ? 'Meta atingida' : `Meta ${formatPercent(metric.target)}`)}</span>}</div>
                  </div>
                );
              })}
            </div>

            <div className="report-note"><CircleHelp size={15} /><span>O consolidado soma as quantidades do mês e recalcula os percentuais sobre as mesmas bases do modelo original. O nome e a meta do produto sazonal são específicos deste mês.</span></div>
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

      {campaignModal && (
        <div className="modal-backdrop">
          <section className="profile-modal campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-title">
            <div className="modal-heading">
              <div className="brand-mark modal-brand"><Smartphone size={18} /></div>
              <div><p className="eyebrow">PRODUTO SAZONAL</p><h2 id="campaign-title">Produto e meta do mês</h2></div>
              <button className="icon-button modal-close" onClick={() => setCampaignModal(false)} title="Fechar"><X size={17} /></button>
            </div>
            <p className="modal-description">O item pode mudar conforme a campanha dos Correios. Nome e meta ficam guardados por mês; os meses anteriores não são alterados.</p>
            <div className="campaign-month-readonly"><CalendarDays size={16} /> Configuração de {formatMonth(campaignDraft.month)}</div>
            <label className="form-field"><span>Nome do produto oferecido</span><input autoFocus maxLength={48} value={campaignDraft.name} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Chip Correios Celular" /></label>
            <label className="form-field"><span>Meta de vendas no mês (unidades)</span><input type="number" min="0" step="1" value={campaignDraft.target} onChange={(event) => setCampaignDraft((current) => ({ ...current, target: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} /></label>
            <button className="primary-button modal-save" onClick={persistCampaignSettings}><Check size={16} /> Salvar produto e meta</button>
          </section>
        </div>
      )}

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
