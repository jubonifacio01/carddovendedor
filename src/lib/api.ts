import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AppState, DailyEntry, Profile } from '../types';

const STORAGE_KEY = 'card-do-vendedor-state-v1';

function readBrowserState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profile: null, entries: [] };
    const parsed = JSON.parse(raw) as AppState;
    return {
      profile: parsed.profile ?? null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { profile: null, entries: [] };
  }
}

function writeBrowserState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function loadState(): Promise<AppState> {
  if (isTauri()) return invoke<AppState>('load_state');
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
    await invoke('replace_state', { profile: state.profile, entries: state.entries });
    return;
  }
  writeBrowserState(state);
}
