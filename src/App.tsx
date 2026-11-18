import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Archive, ArrowDownToLine, CalendarDays, Check, ChevronRight,
  CircleHelp, ClipboardList, CloudOff, FileSpreadsheet, History, Maximize2,
  Minimize2, Minus, Plus, Settings2, ShieldCheck, Smartphone, Target,
  Trash2, Truck, X, Undo2, Pencil,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog';
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
  const saveTimeoutRef = useRef<number | null>(null);
  const activeSaveRef = useRef<Promise<void> | null>(null);
  const shouldFollowTodayRef = useRef(true);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [compactMode, setCompactMode] = useState(() => {
    try { return localStorage.getItem('card-vendedor-compact-mode') === 'true'; }
    catch { return false; }
  });
  const initialWindowModeApplied = useRef(false);
  const [draft, setDraft] = useState<DailyEntry>(EMPTY_ENTRY(todayISO()));
  const [draftDirty, setDraftDirty] = useState(false);
  const [lastAction, setLastAction] = useState<{ date: string; field: EntryField; previousValue: number; label: string } | null>(null);
  const [editingField, setEditingField] = useState<EntryField | null>(null);
  const [editingValue, setEditingValue] = useState('');
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
    document.body.classList.toggle('compact-window', compactMode);
    return () => document.body.classList.remove('compact-window');
  }, [compactMode]);

  // Restaura o formato escolhido pelo atendente na última utilização.
  useEffect(() => {
    if (!loaded || initialWindowModeApplied.current || !isTauri()) return;
    initialWindowModeApplied.current = true;
    void invoke('set_window_mode', { compact: compactMode }).catch((error) => {
      setNotice(`Não foi possível restaurar o formato da janela: ${String(error)}`);
    });
  }, [loaded, compactMode]);

  useEffect(() => {
    let active = true;
    loadState()
      .then((loadedState) => {
        if (!active) return;
        setAppState(loadedState);
        if (!loadedState.profile) {
          // A configuração inicial precisa de espaço para o formulário completo.
          if (compactMode) {
            setCompactMode(false);
            try { localStorage.setItem('card-vendedor-compact-mode', 'false'); } catch { /* preferência opcional */ }
          }
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
    const timeout = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      const operation = (async () => {
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
      })();
      activeSaveRef.current = operation;
      void operation.finally(() => {
        if (activeSaveRef.current === operation) activeSaveRef.current = null;
      });
    }, 220);
    saveTimeoutRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (saveTimeoutRef.current === timeout) saveTimeoutRef.current = null;
    };
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

  const switchDisplayMode = async (compact: boolean) => {
    try {
      if (isTauri()) await invoke('set_window_mode', { compact });
      try { localStorage.setItem('card-vendedor-compact-mode', String(compact)); } catch { /* preferência opcional */ }
      setTab('entry');
      setWindowMaximized(false);
      setCompactMode(compact);
      return true;
    } catch (error) {
      notify(`Não foi possível alterar o formato da janela: ${String(error)}`);
      return false;
    }
  };

  const updateValue = (field: EntryField, value: number) => {
    draftRevisionRef.current += 1;
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setDraft((current) => ({ ...current, [field]: safeValue, updatedAt: new Date().toISOString() }));
    setDraftDirty(true);
    setLastAction(null);
  };

  const registerIncrement = (field: EntryField) => {
    const previousValue = draft[field];
    const fieldLabel = field === 'monthlyProductQty'
      ? selectedMonthlyProduct.name
      : SERVICE_LABELS[field as keyof typeof SERVICE_LABELS];
    updateValue(field, previousValue + 1);
    setLastAction({ date: selectedDate, field, previousValue, label: fieldLabel });
  };

  const undoLastIncrement = () => {
    if (!lastAction || lastAction.date !== selectedDate) return;
    updateValue(lastAction.field, lastAction.previousValue);
    setLastAction(null);
    notify(`Último lançamento desfeito: ${lastAction.label}.`);
  };

  const beginQuantityEdit = (field: EntryField) => {
    setEditingField(field);
    setEditingValue(String(draft[field]));
  };

  const commitQuantityEdit = () => {
    if (!editingField) return;
    const parsed = Number(editingValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      notify('Informe uma quantidade válida, igual ou maior que zero.');
      return;
    }
    updateValue(editingField, Math.floor(parsed));
    setEditingField(null);
  };

  // Atalhos numéricos reduzem a necessidade de trocar o mouse pelo teclado durante o atendimento.
  useEffect(() => {
    const handleQuickKeys = (event: KeyboardEvent) => {
      if (tab !== 'entry' || compactMode || profileModal || campaignModal || editingField) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches('input, textarea, select') || active?.isContentEditable) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (lastAction?.date === selectedDate) {
          event.preventDefault();
          undoLastIncrement();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (!/^[1-7]$/.test(event.key)) return;
      const fields: EntryField[] = ['pac', 'sedex', 'premium', 'vd', 'ar', 'packaging', 'monthlyProductQty'];
      event.preventDefault();
      registerIncrement(fields[Number(event.key) - 1]);
    };

    window.addEventListener('keydown', handleQuickKeys);
    return () => window.removeEventListener('keydown', handleQuickKeys);
  }, [tab, compactMode, profileModal, campaignModal, editingField, lastAction, selectedDate, draft, selectedMonthlyProduct.name]);


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

  const openCampaignSettings = async (month = selectedMonth) => {
    if (compactMode && !(await switchDisplayMode(false))) return;
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

  const openProfile = async () => {
    if (compactMode && !(await switchDisplayMode(false))) return;
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

  const normalizeBackup = (raw: unknown): AppState => {
    if (!raw || typeof raw !== 'object') throw new Error('O arquivo não contém um objeto JSON válido.');
    const backup = raw as Record<string, unknown>;
    if (backup.app !== 'Card do Vendedor' || !Array.isArray(backup.entries)) {
      throw new Error('O arquivo selecionado não é um backup do Card do Vendedor. Selecione o arquivo JSON exportado pelo aplicativo.');
    }
    const wholeNumber = (value: unknown, label: string) => {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) {
        throw new Error(`O campo “${label}” contém uma quantidade inválida.`);
      }
      return number;
    };
    const percentage = (value: unknown, label: string) => {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number < 0) throw new Error(`A meta de ${label} é inválida.`);
      return number;
    };

    let profile: Profile | null = null;
    if (backup.profile !== null && backup.profile !== undefined) {
      if (typeof backup.profile !== 'object') throw new Error('Os dados de identificação do backup estão inválidos.');
      const source = backup.profile as Record<string, unknown>;
      const sourceTargets = (source.targets && typeof source.targets === 'object' ? source.targets : {}) as Record<string, unknown>;
      profile = {
        name: String(source.name ?? '').trim(),
        agency: String(source.agency ?? ''),
        targets: {
          sedex: percentage(sourceTargets.sedex ?? DEFAULT_TARGETS.sedex, 'SEDEX'),
          premium: percentage(sourceTargets.premium ?? DEFAULT_TARGETS.premium, 'Premium'),
          vd: percentage(sourceTargets.vd ?? DEFAULT_TARGETS.vd, 'VD'),
          ar: percentage(sourceTargets.ar ?? DEFAULT_TARGETS.ar, 'AR'),
          packaging: percentage(sourceTargets.packaging ?? DEFAULT_TARGETS.packaging, 'Embalagem'),
        },
      };
      if (!profile.name) throw new Error('O backup não contém o nome do atendente.');
    }

    const entries: DailyEntry[] = backup.entries.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error(`O lançamento ${index + 1} está inválido.`);
      const source = item as Record<string, unknown>;
      const date = String(source.date ?? '');
      const [year, month, day] = date.split('-').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month - 1 || parsedDate.getDate() !== day) {
        throw new Error(`A data do lançamento ${index + 1} está inválida.`);
      }
      return {
        date,
        pac: wholeNumber(source.pac, 'PAC'),
        sedex: wholeNumber(source.sedex, 'SEDEX'),
        premium: wholeNumber(source.premium, 'Premium'),
        vd: wholeNumber(source.vd, 'VD'),
        ar: wholeNumber(source.ar, 'AR'),
        packaging: wholeNumber(source.packaging, 'Embalagem'),
        monthlyProductQty: wholeNumber(source.monthlyProductQty ?? source.cellular, 'Produto sazonal'),
        updatedAt: String(source.updatedAt ?? new Date().toISOString()),
      };
    });

    if (backup.monthlyProducts !== undefined && !Array.isArray(backup.monthlyProducts)) {
      throw new Error('A lista de produtos sazonais do backup está inválida.');
    }
    const monthlyProducts: MonthlyProduct[] = Array.isArray(backup.monthlyProducts)
      ? backup.monthlyProducts.map((item, index) => {
          if (!item || typeof item !== 'object') throw new Error(`A configuração sazonal ${index + 1} está inválida.`);
          const source = item as Record<string, unknown>;
          const month = String(source.month ?? '');
          const name = String(source.name ?? '').trim();
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !name) {
            throw new Error(`A configuração sazonal ${index + 1} está inválida.`);
          }
          return { month, name, target: wholeNumber(source.target, `Meta de ${name}`) };
        })
      : [];

    const uniqueDates = new Set(entries.map((entry) => entry.date));
    if (uniqueDates.size !== entries.length) throw new Error('O backup contém mais de um lançamento para a mesma data.');
    const uniqueMonths = new Set(monthlyProducts.map((product) => product.month));
    if (uniqueMonths.size !== monthlyProducts.length) throw new Error('O backup contém configurações sazonais duplicadas para o mesmo mês.');
    return { profile, entries, monthlyProducts };
  };

  const restoreBackupText = async (contents: string) => {
    const parsed: unknown = JSON.parse(contents);
    const restored = normalizeBackup(parsed);
    const summary = `${restored.entries.length} dia(s) registrado(s), ${restored.monthlyProducts.length} configuração(ões) de produto sazonal`;
    if (!window.confirm(`O backup contém ${summary}.\n\nA restauração substituirá os dados atuais deste computador. Deseja continuar?`)) return;
    draftRevisionRef.current += 1;
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (activeSaveRef.current) {
      await activeSaveRef.current;
    } else if (draftDirty && appState.profile) {
      await saveEntry({ ...draft, date: selectedDate, updatedAt: new Date().toISOString() });
    }
    setDraftDirty(false);
    setSaving(false);
    await replaceState(restored);
    const refreshed = await loadState();
    setAppState(refreshed);
    draftRevisionRef.current += 1;
    setDraft(refreshed.entries.find((entry) => entry.date === selectedDate) ?? EMPTY_ENTRY(selectedDate));
    setDraftDirty(false);
    if (refreshed.profile) setProfileModal(false);
    else setProfileModal(true);
    notify(`Backup restaurado: ${summary}.`);
  };

  const handleBackupRestore = async (file?: File) => {
    if (!file) return;
    try {
      const contents = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler o conteúdo do arquivo.'));
        reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo selecionado.'));
        reader.readAsText(file, 'UTF-8');
      });
      await restoreBackupText(contents);
    } catch (error) {
      notify(`Não foi possível restaurar o backup: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (backupInput.current) backupInput.current.value = '';
    }
  };

  const chooseBackupToRestore = async () => {
    try {
      if (!isTauri()) {
        backupInput.current?.click();
        return;
      }
      const selected = await showOpenDialog({
        title: 'Selecionar backup do Card do Vendedor',
        multiple: false,
        directory: false,
        filters: [{ name: 'Backup do Card do Vendedor', extensions: ['json'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const contents = await invoke<string>('read_backup_file', { path: selected });
      await restoreBackupText(contents);
    } catch (error) {
      notify(`Não foi possível restaurar o backup: ${error instanceof Error ? error.message : String(error)}`);
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
    <main className={`app-shell ${windowMaximized ? 'is-maximized' : ''} ${compactMode ? 'compact-mode' : ''}`}>

      {compactMode ? (
        <header
          className="compact-header"
          onMouseDown={startWindowDrag}
        >
          <div className="compact-brand" title={saving || draftDirty ? 'Salvando lançamento…' : 'Lançamentos salvos automaticamente'}>
            <Truck size={14} strokeWidth={2.4} />
            <strong>Card do Vendedor</strong>
            <span className={`compact-save-dot ${saving || draftDirty ? 'is-saving' : ''}`} />
          </div>
          <label className="compact-date" title="Data do lançamento">
            <CalendarDays size={11} />
            <input
              aria-label="Data do lançamento"
              type="date"
              value={selectedDate}
              onChange={(event) => { shouldFollowTodayRef.current = event.target.value === systemDate; setSelectedDate(event.target.value); }}
            />
          </label>
          <div className="compact-window-actions">
            <button className="compact-window-button" title="Identificação e metas" onClick={openProfile}><Settings2 size={13} /></button>
            <button className="compact-window-button" title="Restaurar painel completo" onClick={() => void switchDisplayMode(false)}><Maximize2 size={13} /></button>
            <button className="compact-window-button compact-hide" title="Ocultar na bandeja" onClick={hideWindow}><X size={13} /></button>
          </div>
        </header>
      ) : (
        <header
          className="window-header refined-header"
          onMouseDown={startWindowDrag}
          onDoubleClick={(event) => {
            if (!(event.target as HTMLElement).closest('button, input, label')) void toggleWindowSize();
          }}
        >
          <div className="brand-mark"><Truck size={18} strokeWidth={2.2} /></div>
          <div className="brand-title refined-brand-title">
            <strong>Card do Vendedor</strong>
            <span>Apontamento rápido</span>
          </div>
          <div className="header-profile refined-header-profile" title={`${appState.profile?.name || ''} · ${appState.profile?.agency || ''}`}>
            <div className="avatar">{appState.profile?.name?.slice(0, 1).toLocaleUpperCase('pt-BR') || 'A'}</div>
            <div className="profile-info">
              <strong>{appState.profile?.name || 'Configure seu perfil'}</strong>
              <span>{appState.profile?.agency || 'Agência não informada'}</span>
            </div>
          </div>
          {tab === 'entry' && (
            <div className="header-date-control" title="Data dos lançamentos">
              <CalendarDays size={14} />
              <input aria-label="Data do lançamento" type="date" value={selectedDate} onChange={(event) => {
                shouldFollowTodayRef.current = event.target.value === systemDate;
                setSelectedDate(event.target.value);
                setLastAction(null);
                setEditingField(null);
              }} />
              {selectedDate !== systemDate && <button type="button" onClick={() => {
                shouldFollowTodayRef.current = true;
                setSelectedDate(systemDate);
                setLastAction(null);
                setEditingField(null);
              }}>Hoje</button>}
            </div>
          )}
          <nav className="tabs top-tabs refined-tabs" aria-label="Navegação principal">
            <button className={tab === 'entry' ? 'tab active' : 'tab'} onClick={() => setTab('entry')}><Plus size={13} /><span>Lançar</span></button>
            <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => { setLastAction(null); setTab('history'); }}><History size={13} /><span>Histórico</span></button>
            <button className={tab === 'report' ? 'tab active' : 'tab'} onClick={() => { setLastAction(null); setTab('report'); }}><FileSpreadsheet size={13} /><span>Relatório</span></button>
          </nav>
          <div className="header-actions refined-header-actions">
            <button className="window-control compact-toggle" title="Modo micro · aproximadamente 10 × 3 cm" onClick={() => void switchDisplayMode(true)}><Minimize2 size={15} /></button>
            <button className="window-control" title="Minimizar janela" onClick={minimizeWindow}><Minus size={16} /></button>
            <button className="window-control" title={windowMaximized ? 'Restaurar janela' : 'Maximizar janela'} onClick={toggleWindowSize}>{windowMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            <button className="window-control close-button" title="Ocultar na bandeja" onClick={hideWindow}><X size={16} /></button>
          </div>
        </header>
      )}

      <div className={`content-area ${compactMode ? 'compact-content' : ''}`}>
        {compactMode && tab === 'entry' && (
          <div className="compact-service-grid" aria-label="Lançamentos rápidos">
            {([...Object.keys(SERVICE_LABELS), 'monthlyProductQty'] as EntryField[]).map((field) => {
              const isMonthlyProduct = field === 'monthlyProductQty';
              const fieldLabel = isMonthlyProduct ? selectedMonthlyProduct.name : SERVICE_LABELS[field as keyof typeof SERVICE_LABELS];
              const compactLabel = isMonthlyProduct
                ? (fieldLabel.toLocaleUpperCase('pt-BR').includes('CHIP') ? 'CHIP' : fieldLabel.slice(0, 5).toLocaleUpperCase('pt-BR'))
                : ({ pac: 'PAC', sedex: 'SEDEX', premium: 'PREM', vd: 'VD', ar: 'AR', packaging: 'EMB' } as const)[field as keyof typeof SERVICE_LABELS];
              return (
                <article className={`compact-service ${isMonthlyProduct ? 'compact-campaign' : ''}`} key={field}>
                  {isMonthlyProduct ? (
                    <button className="compact-service-label compact-product-label" title={`${fieldLabel} · Meta ${selectedMonthlyProduct.target || 'não definida'} unidades · Clique para configurar`} onClick={() => void openCampaignSettings(selectedMonth)}>{compactLabel}</button>
                  ) : (
                    <span className="compact-service-label" title={fieldLabel}>{compactLabel}</span>
                  )}
                  <div className="compact-count-line">
                    <strong className="compact-count" aria-live="polite">{draft[field]}</strong>
                  </div>
                  <button className="compact-increment" aria-label={`Registrar mais um: ${fieldLabel}`} title={`Registrar mais um: ${fieldLabel}`} onClick={() => registerIncrement(field)}>+1</button>
                </article>
              );
            })}
          </div>
        )}
        {!compactMode && tab === 'entry' && (
          <>
            <div className="quick-entry-toolbar">
              <div className="quick-entry-date-label">
                <span>LANÇAMENTOS DO DIA</span>
                <strong>{formatDate(selectedDate)}</strong>
              </div>
              <div className="quick-entry-hints">
                <span className="keyboard-hint"><kbd>1–7</kbd> atalhos do teclado</span>
                {lastAction?.date === selectedDate && (
                  <button className="undo-inline" onClick={undoLastIncrement} title="Desfazer último lançamento · Ctrl+Z"><Undo2 size={13} /> Desfazer</button>
                )}
                <span className="quick-save-state"><ShieldCheck size={14} /> {saving || draftDirty ? 'Salvando…' : 'Salvo'}</span>
              </div>
            </div>

            <div className="service-grid refined-service-grid" aria-label="Toque em um serviço para registrar uma unidade">
              {([...Object.keys(SERVICE_LABELS), 'monthlyProductQty'] as EntryField[]).map((field, index) => {
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
                    ? `${selectedProductTotal} no mês${selectedMonthlyProduct.target > 0 ? ` · Meta ${selectedMonthlyProduct.target}` : ''}`
                    : `Participação ${formatPercent(rate ?? 0)}`;
                const editing = editingField === field;
                return (
                  <article
                    className={`quick-tile ${isMonthlyProduct ? 'quick-tile-campaign' : ''} ${field === 'pac' ? 'quick-tile-base' : ''}`}
                    key={field}
                    role="group"
                    tabIndex={0}
                    aria-label={`${fieldLabel}: ${draft[field]} unidades. Clique no cartão para adicionar uma unidade; clique no número para corrigir.`}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button, input')) return;
                      if (editingField) return;
                      registerIncrement(field);
                    }}
                    onKeyDown={(event) => {
                      if ((event.target as HTMLElement) !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (!editingField) registerIncrement(field);
                      }
                    }}
                  >
                    <div className="quick-tile-top">
                      <span className={`quick-tile-icon symbol-${isMonthlyProduct ? 'cellular' : field}`}>
                        {isMonthlyProduct ? <Smartphone size={16} /> : field === 'pac' || field === 'sedex' ? <Truck size={16} /> : <Archive size={16} />}
                      </span>
                      <div className="quick-tile-labels">
                        <strong title={fieldLabel}>{fieldLabel}</strong>
                        <span title={descriptor}>{descriptor}</span>
                      </div>
                      <kbd className="tile-shortcut" title={`Atalho ${index + 1}`}>{index + 1}</kbd>
                      {isMonthlyProduct && <button className="quick-tile-config" onClick={(event) => { event.stopPropagation(); void openCampaignSettings(selectedMonth); }} title="Alterar produto e meta"><Settings2 size={13} /></button>}
                    </div>
                    <div className="quick-tile-bottom">
                      {editing ? (
                        <div className="quick-tile-editor" onClick={(event) => event.stopPropagation()}>
                          <input
                            aria-label={`Corrigir quantidade de ${fieldLabel}`}
                            type="number"
                            min="0"
                            step="1"
                            autoFocus
                            value={editingValue}
                            onChange={(event) => setEditingValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') { event.preventDefault(); commitQuantityEdit(); }
                              if (event.key === 'Escape') { event.preventDefault(); setEditingField(null); }
                            }}
                          />
                          <button onClick={commitQuantityEdit} title="Salvar quantidade"><Check size={14} /></button>
                          <button onClick={() => setEditingField(null)} title="Cancelar edição"><X size={13} /></button>
                        </div>
                      ) : (
                        <button className="quick-tile-count" aria-live="polite" onClick={(event) => { event.stopPropagation(); beginQuantityEdit(field); }} title="Clique no número para corrigir a quantidade" aria-label={`Editar quantidade ${fieldLabel}`}>
                          {draft[field]} <Pencil size={10} />
                        </button>
                      )}
                      <span className="quick-tile-add"><Plus size={14} /> <span>+1</span></span>
                    </div>
                    {isMonthlyProduct && selectedMonthlyProduct.target > 0 && (
                      <div className="quick-tile-progress" aria-label={`${Math.round(selectedProductProgress)}% da meta mensal`}><span style={{ width: `${selectedProductProgress}%` }} /></div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="refined-action-bar">
              <span className="action-bar-instruction">Toque no cartão para registrar <strong>+1</strong>; clique no número para corrigir.</span>
              <span className="keyboard-hint"><kbd>1–7</kbd> atalhos</span>
              {lastAction?.date === selectedDate && (
                <button className="undo-inline" onClick={undoLastIncrement} title={`Desfazer: ${lastAction.label} · Ctrl+Z`}><Undo2 size={13} /> Desfazer</button>
              )}
              <span className="quick-save-state"><ShieldCheck size={14} /> {saving || draftDirty ? 'Salvando…' : 'Salvo automaticamente'}</span>
            </div>
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

      {!compactMode && <footer className="app-footer">
        <span><CloudOff size={13} /> Funciona sem internet</span>
        <button onClick={openProfile}><Target size={13} /> Metas e perfil</button>
      </footer>}

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
              <button onClick={chooseBackupToRestore}><Archive size={14} /> Restaurar backup</button>
              <input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={(event) => handleBackupRestore(event.target.files?.[0])} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
