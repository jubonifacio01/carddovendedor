export type Targets = {
  sedex: number;
  premium: number;
  vd: number;
  ar: number;
  packaging: number;
};

export type Profile = {
  name: string;
  agency: string;
  targets: Targets;
};

export type DailyEntry = {
  date: string;
  pac: number;
  sedex: number;
  premium: number;
  vd: number;
  ar: number;
  packaging: number;
  cellular: number;
  updatedAt: string;
};

export type AppState = {
  profile: Profile | null;
  entries: DailyEntry[];
};

export const DEFAULT_TARGETS: Targets = {
  sedex: 0.88,
  premium: 0.0265,
  vd: 0.35,
  ar: 0.35,
  packaging: 0.4,
};

export const EMPTY_ENTRY = (date: string): DailyEntry => ({
  date,
  pac: 0,
  sedex: 0,
  premium: 0,
  vd: 0,
  ar: 0,
  packaging: 0,
  cellular: 0,
  updatedAt: new Date().toISOString(),
});

export const SERVICE_LABELS: Record<keyof Omit<DailyEntry, 'date' | 'updatedAt'>, string> = {
  pac: 'PAC',
  sedex: 'SEDEX',
  premium: 'Premium 10 e 12',
  vd: 'VD',
  ar: 'AR',
  packaging: 'Embalagem',
  cellular: 'Correios Celular',
};
