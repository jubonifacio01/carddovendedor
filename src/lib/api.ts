import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AppState, DailyEntry, MonthlyProduct, Profile } from '../types';

const STORAGE_KEY = 'card-do-vendedor-state-v2';
const LEGACY_STORAGE_KEY = 'card-do-vendedor-state-v1';

type LegacyDailyEntry = Partial<DailyEntry> & { date: string; cellular?: number };

function normalizeEntry(entry: LegacyDailyEntry): DailyEntry {
  return {
    date: entry.date,
    pac: Number(entry.pac ?? 0),
    sedex: Number(entry.sedex ?? 0),
    premium: Number(entry.premium ?? 0),
    vd: Number(entry.vd ?? 0),
    ar: Number(entry.ar ?? 0),
    packaging: Number(entry.packaging ?? 0),
    // Mantém os lançamentos de Correios Celular feitos nas versões anteriores.
    monthlyProductQty: Number(entry.monthlyProductQty ?? entry.cellular ?? 0),
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  };
}

function normalizeState(parsed: Partial<AppState> & { entries?: LegacyDailyEntry[] }): AppState {
  return {
    profile: parsed.profile ?? null,
    entries: Array.isArray(parsed.entries) ? parsed.entries.map(normalizeEntry) : [],
    monthlyProducts: Array.isArray(parsed.monthlyProducts) ? parsed.monthlyProducts : [],
  };
}

function readBrowserState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { profile: null, entries: [], monthlyProducts: [] };
    return normalizeState(JSON.parse(raw));
  } catch {
    return { profile: null, entries: [], monthlyProducts: [] };
  }
}

function writeBrowserState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function loadState(): Promise<AppState> {
  if (isTauri()) {
    const state = await invoke<AppState>('load_state');
    return normalizeState(state as AppState & { entries: LegacyDailyEntry[] });
  }
  return readBrowserState();
}

export async function saveProfile(profile: Profile): Promise<void> {
  if (isTauri()) {
    await invoke('save_profile', { profile });
    return;
  }
  const state = readBrowserState();
  writeBrowserState({ ...state, profile });
}

export async function saveEntry(entry: DailyEntry): Promise<void> {
  if (isTauri()) {
    await invoke('save_entry', { entry });
    return;
  }
  const state = readBrowserState();
  const entries = state.entries.filter((item) => item.date !== entry.date);
  entries.push(entry);
  entries.sort((a, b) => b.date.localeCompare(a.date));
  writeBrowserState({ ...state, entries });
}

export async function saveMonthlyProduct(product: MonthlyProduct): Promise<void> {
  if (isTauri()) {
    await invoke('save_monthly_product', { product });
    return;
  }
  const state = readBrowserState();
  const monthlyProducts = state.monthlyProducts.filter((item) => item.month !== product.month);
  monthlyProducts.push(product);
  writeBrowserState({ ...state, monthlyProducts });
}

export async function deleteEntry(date: string): Promise<void> {
  if (isTauri()) {
    await invoke('delete_entry', { date });
    return;
  }
  const state = readBrowserState();
  writeBrowserState({ ...state, entries: state.entries.filter((item) => item.date !== date) });
}

export async function replaceState(state: AppState): Promise<void> {
  if (isTauri()) {
    await invoke('replace_state', { state });
    return;
  }
  writeBrowserState(state);
}
