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

export type MonthlyProduct = {
  month: string;
  name: string;
  target: number;
};

export type DailyEntry = {
  date: string;
  pac: number;
  sedex: number;
  premium: number;
  vd: number;
  ar: number;
  packaging: number;
  monthlyProductQty: number;
  updatedAt: string;
};

export type AppState = {
  profile: Profile | null;
  entries: DailyEntry[];
  monthlyProducts: MonthlyProduct[];
};

export const DEFAULT_TARGETS: Targets = {
  sedex: 0.88,
  premium: 0.0265,
  vd: 0.35,
  ar: 0.35,
  packaging: 0.4,
};

export const DEFAULT_MONTHLY_PRODUCT_NAME = 'Correios Celular';

export const EMPTY_ENTRY = (date: string): DailyEntry => ({
  date,
  pac: 0,
  sedex: 0,
  premium: 0,
  vd: 0,
  ar: 0,
  packaging: 0,
  monthlyProductQty: 0,
  updatedAt: new Date().toISOString(),
});

export const SERVICE_LABELS = {
  pac: 'PAC',
  sedex: 'SEDEX',
  premium: 'Premium 10 e 12',
  vd: 'VD',
  ar: 'AR',
  packaging: 'Embalagem',
} as const;

export type EntryField = keyof typeof SERVICE_LABELS | 'monthlyProductQty';
