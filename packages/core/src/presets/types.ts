import type { Questions, State } from '../systemone/types';

/**
 * A preset is one screen of the Playground. It declares a form (fields) and compiles the
 * form's body into the official request: `{ state, questions }` (the model is added later).
 *
 *  - 'native'  → you write state + questions yourself (the raw official API).
 *  - 'recipe'  → a reusable question set, inspired by community recipes, that the Studio
 *                builds from simple fields. Nothing is hidden: the compiled questions are
 *                shown in the request preview and can be edited as raw JSON.
 */

export type FieldKind =
  | 'text' // single line string
  | 'textarea' // multi-line string
  | 'enum' // string with suggested options (free text still allowed)
  | 'list' // repeatable string -> string[]
  | 'json' // JSON object edited as text
  | 'state' // JSON object/array, or plain text when it isn't JSON
  | 'candidates'; // list of { id, description, ...extra }

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: readonly string[];
  minItems?: number;
}

export interface Candidate {
  id: string;
  description: string;
  /** Extra JSON properties merged into the candidate (e.g. {"cost":"low"}). */
  extra: string;
}

export type FieldValue = string | string[] | Candidate[];
export type FormValues = Record<string, FieldValue>;

export interface Preset {
  id: string;
  title: string;
  kind: 'native' | 'recipe';
  /** The question this preset answers, in plain words. */
  question: string;
  summary: string;
  /** Key of the question shown as headline (history, badges). */
  primary?: string;
  /** Options of the primary choice question, used to order and color results. */
  decisions: readonly string[];
  fields: readonly FieldDef[];
  example: FormValues;
  /** Form body (see buildBody) -> official `{ state, questions }`. */
  compile(body: Record<string, unknown>): { state: State; questions: Questions };
}
