import type { Language } from '../types';

// All numbers and dates are always rendered in English (Latin digits, en-US)
// in both UI languages, per product requirement.
const NUMERIC_LOCALE = 'en-US';

export function formatBytes(value?: number | null, _language: Language = 'ar') {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), units.length - 1);
  const number = value / 1024 ** exponent;
  return `${new Intl.NumberFormat(NUMERIC_LOCALE, { maximumFractionDigits: number >= 100 ? 0 : 1 }).format(number)} ${units[exponent]}`;
}

export function formatDate(value?: string | null, _language: Language = 'ar', withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(NUMERIC_LOCALE, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}

export function formatRelative(value?: string | null, _language: Language = 'ar') {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const ranges: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.34524, 'week'], [12, 'month'], [Infinity, 'year']];
  let duration = seconds;
  for (const [divisor, unit] of ranges) {
    if (Math.abs(duration) < divisor) {
      return new Intl.RelativeTimeFormat(NUMERIC_LOCALE, { numeric: 'auto' }).format(Math.round(duration), unit);
    }
    duration /= divisor;
  }
  return formatDate(value, _language);
}

export function clampProgress(value?: number | null) {
  return Math.max(0, Math.min(100, value ?? 0));
}
