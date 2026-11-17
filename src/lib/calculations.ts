import type { DailyEntry } from '../types';

export type MonthlyTotals = Pick<DailyEntry, 'pac' | 'sedex' | 'premium' | 'vd' | 'ar' | 'packaging' | 'cellular'>;
export type IndicatorRates = Pick<MonthlyTotals, 'sedex' | 'premium' | 'vd' | 'ar' | 'packaging'>;

const ratio = (quantity: number, base: number) => base > 0 ? quantity / base : 0;

export function sumEntries(entries: DailyEntry[]): MonthlyTotals {
  return entries.reduce((total, entry) => ({
    pac: total.pac + entry.pac,
    sedex: total.sedex + entry.sedex,
    premium: total.premium + entry.premium,
    vd: total.vd + entry.vd,
    ar: total.ar + entry.ar,
    packaging: total.packaging + entry.packaging,
    cellular: total.cellular + entry.cellular,
  }), { pac: 0, sedex: 0, premium: 0, vd: 0, ar: 0, packaging: 0, cellular: 0 });
}

export function calculateRates(values: Pick<DailyEntry, 'pac' | 'sedex' | 'premium' | 'vd' | 'ar' | 'packaging'>): IndicatorRates {
  const sedexBase = values.pac + values.sedex;
  const otherBase = values.pac + values.sedex + values.premium;
  return {
    sedex: ratio(values.sedex, sedexBase),
    premium: ratio(values.premium, otherBase),
    vd: ratio(values.vd, otherBase),
    ar: ratio(values.ar, otherBase),
    packaging: ratio(values.packaging, otherBase),
  };
}
