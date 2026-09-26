import type { Answer, SystemOneResponse } from './types';

/** The headline of a response: one answer, flattened for tables and badges. */
export interface DecisionSummary {
  /** Key of the question used as headline. */
  question?: string;
  type?: Answer['type'];
  /** Chosen option (choice), or the legend level nearest to the score (score). */
  decision?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  score?: number;
  noul?: number;
}

export function summarizeAnswer(question: string, a: Answer): DecisionSummary {
  switch (a.type) {
    case 'choice':
      return { question, type: 'choice', decision: a.choice, confidence: a.confidence, probabilities: a.probabilities };
    case 'score': {
      const level = a.legend?.[String(Math.round(a.score))];
      return {
        question,
        type: 'score',
        score: a.score,
        confidence: a.confidence,
        probabilities: a.probabilities,
        decision: typeof level === 'string' ? level : undefined,
      };
    }
    case 'noul':
      return { question, type: 'noul', noul: a.noul };
  }
}

/**
 * Headline answer: the recipe's primary question if present,
 * otherwise the first choice, then the first answer of any type.
 */
export function summarize(response: SystemOneResponse | null | undefined, primary?: string): DecisionSummary {
  const answers = response?.answers;
  if (!answers || typeof answers !== 'object') return {};
  const entries = Object.entries(answers).filter(([, a]) => a && typeof a === 'object');
  const hit =
    (primary ? entries.find(([k]) => k === primary) : undefined) ??
    entries.find(([, a]) => a.type === 'choice') ??
    entries[0];
  return hit ? summarizeAnswer(hit[0], hit[1]) : {};
}
