import { z } from 'zod';
import type { SystemOneRequest } from '../systemone/types';
import type { Candidate, FieldDef, FormValues, Preset } from './types';

export type FieldErrors = Record<string, string>;
export type BuildResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; errors: FieldErrors; body: Record<string, unknown> };

/** Empty form values for a preset (what a blank form starts with). */
export function emptyValues(preset: Preset): FormValues {
  const values: FormValues = {};
  for (const f of preset.fields) {
    values[f.key] = f.kind === 'list' || f.kind === 'candidates' ? [] : '';
  }
  return values;
}

function parseJsonObject(text: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'Precisa ser um objeto JSON ({ ... }).' };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: `JSON inválido: ${(err as Error).message}` };
  }
}

/** State may be JSON (object/array) or plain text. Text that looks like JSON but fails to parse is an error. */
function parseState(text: string): { value?: unknown; error?: string } {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return { value: text };
  try {
    return { value: JSON.parse(t) };
  } catch (err) {
    return { error: `Parece JSON mas é inválido: ${(err as Error).message}` };
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function asCandidates(v: unknown): Candidate[] {
  return Array.isArray(v) ? (v as Candidate[]) : [];
}

function buildField(f: FieldDef, raw: unknown): { value?: unknown; error?: string } {
  switch (f.kind) {
    case 'text':
    case 'textarea':
    case 'enum': {
      const s = asString(raw).trim();
      if (!s) return f.required ? { error: 'Obrigatório.' } : {};
      return { value: s };
    }
    case 'list': {
      const items = asList(raw).map((s) => s.trim()).filter(Boolean);
      const min = f.minItems ?? (f.required ? 1 : 0);
      if (items.length < min) return { error: `Informe pelo menos ${min} item(ns).` };
      return items.length ? { value: items } : {};
    }
    case 'json': {
      const s = asString(raw).trim();
      if (!s) return f.required ? { error: 'Obrigatório.' } : {};
      const { value, error } = parseJsonObject(s);
      return error ? { error } : { value };
    }
    case 'state': {
      const s = asString(raw);
      if (!s.trim()) return f.required ? { error: 'Obrigatório.' } : {};
      return parseState(s);
    }
    case 'candidates': {
      const out: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const [i, c] of asCandidates(raw).entries()) {
        const id = asString(c.id).trim();
        const description = asString(c.description).trim();
        const extraText = asString(c.extra).trim();
        if (!id && !description && !extraText) continue; // blank row
        if (!id) return { error: `Candidato ${i + 1}: "id" é obrigatório.` };
        if (seen.has(id)) return { error: `Candidato "${id}" repetido.` };
        seen.add(id);
        let extra: Record<string, unknown> = {};
        if (extraText) {
          const parsed = parseJsonObject(extraText);
          if (parsed.error) return { error: `Candidato ${i + 1} (extra): ${parsed.error}` };
          extra = parsed.value ?? {};
        }
        out.push({ ...extra, id, ...(description ? { description } : {}) });
      }
      const min = f.minItems ?? (f.required ? 1 : 0);
      if (out.length < min) return { error: `Informe pelo menos ${min} candidatos.` };
      return out.length ? { value: out } : {};
    }
  }
}

/**
 * Turn form values into the preset's body (its inputs, before compilation).
 * Always returns the best-effort body (for the live preview) plus per-field errors.
 */
export function buildBody(preset: Preset, values: FormValues): BuildResult {
  const body: Record<string, unknown> = {};
  const errors: FieldErrors = {};
  for (const f of preset.fields) {
    const { value, error } = buildField(f, values[f.key]);
    if (error) errors[f.key] = error;
    if (value !== undefined) body[f.key] = value;
  }
  return Object.keys(errors).length ? { ok: false, errors, body } : { ok: true, body };
}

/** Inverse of buildBody: load a body (history, scenarios) back into the form. */
export function bodyToValues(preset: Preset, body: Record<string, unknown>): FormValues {
  const values = emptyValues(preset);
  for (const f of preset.fields) {
    const v = body[f.key];
    if (v === undefined) continue;
    if (f.kind === 'list') values[f.key] = asList(v);
    else if (f.kind === 'json') values[f.key] = JSON.stringify(v, null, 2);
    else if (f.kind === 'state') values[f.key] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    else if (f.kind === 'candidates') {
      values[f.key] = (Array.isArray(v) ? v : []).map((item) => {
        const { id, description, ...extra } = (item ?? {}) as Record<string, unknown>;
        return {
          id: asString(id),
          description: asString(description),
          extra: Object.keys(extra).length ? JSON.stringify(extra) : '',
        };
      });
    } else values[f.key] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return values;
}

/** Preset body + model -> the exact official request. */
export function compileRequest(preset: Preset, body: Record<string, unknown>, model: string): SystemOneRequest {
  const { state, questions } = preset.compile(body);
  return { state, model, questions };
}

/** Zod schema of a preset's body — the API validates before compiling. */
export function bodySchema(preset: Preset) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of preset.fields) {
    let s: z.ZodTypeAny;
    const min = f.minItems ?? (f.required ? 1 : 0);
    switch (f.kind) {
      case 'text':
      case 'textarea':
      case 'enum':
        s = z.string().min(1);
        break;
      case 'list':
        s = z.array(z.string().min(1)).min(min);
        break;
      case 'json':
        s = z.record(z.unknown());
        break;
      case 'state':
        s = z.union([z.string().min(1), z.record(z.unknown()), z.array(z.unknown())]);
        break;
      case 'candidates':
        s = z.array(z.object({ id: z.string().min(1) }).passthrough()).min(min);
        break;
    }
    shape[f.key] = f.required ? s : s.optional();
  }
  return z.object(shape).passthrough();
}

const description = z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]);
const questionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('noul'),
      instructions: description,
      criteria: z.object({ true: description.nullish(), false: description.nullish() }).optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('choice'),
      instructions: description,
      criteria: z.record(description.nullable()).refine((c) => Object.keys(c).length >= 1, 'Pelo menos 1 opção.'),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('score'),
      instructions: description,
      criteria: z.array(z.unknown()).min(2, 'De 2 a 10 níveis.').max(10, 'De 2 a 10 níveis.'),
    })
    .passthrough(),
]);

/** Schema of an official request (what raw mode sends). The model is filled in by the server when absent. */
export const systemOneRequestSchema = z
  .object({
    state: z.union([z.string().min(1), z.record(z.unknown()), z.array(z.unknown())]),
    model: z.string().min(1).optional(),
    questions: z.record(questionSchema).refine((q) => Object.keys(q).length >= 1, 'Pelo menos 1 pergunta.'),
  })
  .passthrough();
