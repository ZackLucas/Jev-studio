import type { Backend, DecisionSummary } from '@jev/core';

export const BACKEND_LABEL: Record<Backend, string> = { typesafe: 'TypeSafe', jeff: 'jeff' };

export const pct = (n: number | undefined) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : '—');

export const ms = (n: number | null | undefined) => (typeof n === 'number' ? `${n} ms` : '—');

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Tone of a decision value, used for badge colors. */
export function decisionTone(decision: string | undefined): 'good' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (!decision) return 'neutral';
  if (['allow', 'accept', 'complete', 'proceed_fast'].includes(decision)) return 'good';
  if (['deny', 'reject', 'block', 'incomplete'].includes(decision)) return 'bad';
  if (['confirm', 'review', 'verify_more', 'deep_review'].includes(decision)) return 'warn';
  return 'info';
}

/** One short label for a summary, whatever the answer type. */
export function summaryLabel(s: DecisionSummary): string | undefined {
  if (s.type === 'noul' && typeof s.noul === 'number') return `${s.question ?? 'sim'}: ${pct(s.noul)}`;
  if (s.type === 'score' && typeof s.score === 'number') return `${s.score.toFixed(2)}${s.decision ? ` · ${s.decision}` : ''}`;
  return s.decision;
}

/** `envVar` null → no Authorization header (local jeff without keys). */
export function curlFor(url: string, body: unknown, envVar: string | null): string {
  const json = JSON.stringify(body).replace(/'/g, `'\\''`);
  const lines = [`curl -X POST '${url}'`];
  if (envVar) lines.push(`  -H "Authorization: Bearer $${envVar}"`);
  lines.push(`  -H 'Content-Type: application/json'`, `  -d '${json}'`);
  return lines.join(' \\\n');
}

/** Top-level keys whose values differ between two objects. */
export function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
