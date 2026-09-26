/**
 * Wire types of the official TypeSafe System One API (https://docs.typesafe.ai/api):
 *   POST {baseUrl}/v1/systemone  { state, model, questions } -> { model, answers, usage }
 * jeff (github.com/jarihu/jeff) implements the same wire format.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** Text, or structured data the model reads as context. */
export type State = string | Record<string, unknown> | unknown[];
/** Instructions and criteria descriptions may be text or structured data. */
export type Description = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: 'noul';
  instructions: Description;
  criteria?: { true?: Description | null; false?: Description | null };
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: Description;
  /** option name -> description (or null). Up to 255 options. */
  criteria: Record<string, Description | null>;
}

export interface ScoreLevel {
  what: Description;
  examples?: string[];
}

export interface ScoreQuestion {
  type: 'score';
  instructions: Description;
  /** Ordered levels, lowest first. 2–10 levels. */
  criteria: (Description | ScoreLevel)[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface SystemOneRequest {
  state: State;
  model: string;
  questions: Questions;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}
