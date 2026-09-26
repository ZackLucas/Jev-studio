import type { Description, Questions, State } from '../systemone/types';
import type { Preset } from './types';

const STAKES = ['low', 'medium', 'high'] as const;

/** Keep only the fields the user filled, so the model never reads empty keys. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------

export const decide: Preset = {
  id: 'decide',
  title: 'System One (nativo)',
  kind: 'native',
  question: 'Minhas próprias perguntas.',
  summary: 'A API oficial crua: envie o state e as questions (choice, score, noul) exatamente como quiser.',
  decisions: [],
  fields: [
    {
      key: 'state',
      label: 'State',
      kind: 'state',
      required: true,
      help: 'O que o modelo deve avaliar: texto livre, ou um objeto/array JSON.',
    },
    {
      key: 'questions',
      label: 'Questions',
      kind: 'json',
      required: true,
      help: 'Objeto JSON: cada chave é uma pergunta { type: choice | score | noul, instructions, criteria }.',
    },
  ],
  example: {
    state: JSON.stringify(
      {
        customer_message: 'I was charged twice for order ord_7429. Please fix this ASAP.',
        policy: 'Refunds above USD 500 require human approval.',
      },
      null,
      2,
    ),
    questions: JSON.stringify(
      {
        action: {
          type: 'choice',
          instructions: 'Choose the safest next action.',
          criteria: { refund: 'Issue the refund now.', escalate: 'Send to a human agent.', clarify: 'Ask the customer for details.' },
        },
        billing: { type: 'noul', instructions: 'Is this message about billing?' },
        urgency: { type: 'score', instructions: 'How urgent is this?', criteria: ['low', 'medium', 'high'] },
      },
      null,
      2,
    ),
  },
  compile: (body) => ({ state: body.state as State, questions: body.questions as Questions }),
};

// ---------------------------------------------------------------------------

export const toolGuard: Preset = {
  id: 'tool-guard',
  title: 'Tool guard',
  kind: 'recipe',
  question: 'Posso executar esta ferramenta/ação?',
  summary: 'Antes de uma ação com consequência: permitir, pedir confirmação, mandar para revisão ou negar.',
  primary: 'decision',
  decisions: ['allow', 'confirm', 'review', 'deny'],
  fields: [
    { key: 'tool', label: 'Ferramenta', kind: 'text', required: true, placeholder: 'issue_customer_refund' },
    { key: 'action', label: 'Ação pretendida', kind: 'textarea', required: true },
    { key: 'arguments', label: 'Argumentos', kind: 'list', placeholder: 'order_id=ord_7429' },
    { key: 'side_effects', label: 'Efeitos colaterais', kind: 'list' },
    { key: 'safeguards', label: 'Salvaguardas verificadas', kind: 'list' },
    { key: 'policy', label: 'Políticas', kind: 'list' },
    {
      key: 'reversibility',
      label: 'Reversibilidade',
      kind: 'enum',
      options: ['reversible', 'partially_reversible', 'irreversible'],
    },
  ],
  example: {
    tool: 'issue_customer_refund',
    action: 'Refund USD 680 after a disputed duplicate charge',
    arguments: ['order_id=ord_7429', 'amount_usd=680'],
    side_effects: ['Moves funds', 'Changes the order payment state'],
    safeguards: ['Customer identity and duplicate charge verified'],
    policy: ['Refunds above USD 500 require human approval'],
    reversibility: 'partially_reversible',
  },
  compile: (b) => ({
    state: compact({
      tool: b.tool,
      intended_action: b.action,
      arguments: b.arguments,
      side_effects: b.side_effects,
      verified_safeguards: b.safeguards,
      applicable_policy: b.policy,
      reversibility: b.reversibility,
    }),
    questions: {
      decision: {
        type: 'choice',
        instructions:
          'An automated agent is about to execute this tool call. Decide how it should proceed, weighing the side effects, ' +
          'reversibility, the safeguards already verified and the applicable policy.',
        criteria: {
          allow: 'Safe to execute now: low impact or fully covered by verified safeguards, and no policy requires approval.',
          confirm: 'Execute only after the end user explicitly confirms this exact action.',
          review: 'Hold for a human operator: a policy requires approval, or the risk is significant.',
          deny: 'Do not execute: it violates policy, is unsafe, or is not justified by the request.',
        },
      },
      needs_confirmation: {
        type: 'noul',
        instructions: 'Should a human confirm before this action runs?',
      },
      risk: {
        type: 'score',
        instructions: 'How severe would the harm be if this action turned out to be wrong or unintended?',
        criteria: [
          'Negligible: read-only or trivially reversible',
          'Low: minor impact, easily undone',
          'High: affects money, production systems or customer data',
          'Critical: irreversible, large financial, legal or safety impact',
        ],
      },
    },
  }),
};

export const route: Preset = {
  id: 'route',
  title: 'Route',
  kind: 'recipe',
  question: 'Que tipo de processamento esta tarefa pede?',
  summary: 'Classifica uma tarefa ambígua ou arriscada em uma rota de execução.',
  primary: 'decision',
  decisions: ['proceed_fast', 'deep_review', 'split_task', 'block'],
  fields: [
    { key: 'task', label: 'Tarefa', kind: 'textarea', required: true },
    { key: 'evidence', label: 'Evidências', kind: 'list' },
    { key: 'constraints', label: 'Restrições', kind: 'list' },
  ],
  example: {
    task: 'Resolve a request involving account access and a disputed charge',
    evidence: ['Customer identity is verified'],
    constraints: ['Do not change account state without confirmation'],
  },
  compile: (b) => ({
    state: compact({ task: b.task, available_evidence: b.evidence, constraints: b.constraints }),
    questions: {
      decision: {
        type: 'choice',
        instructions: 'Choose how an agent should handle this task.',
        criteria: {
          proceed_fast: 'Clear, low-risk and well specified: act directly.',
          deep_review: 'Ambiguous, sensitive or high-stakes: investigate carefully before acting.',
          split_task: 'Several independent parts: break it into smaller steps first.',
          block: 'Should not be done: unsafe, disallowed or impossible.',
        },
      },
      needs_human_review: {
        type: 'noul',
        instructions: 'Does this task need a human to review the plan before the agent acts?',
      },
    },
  }),
};

export const modelRoute: Preset = {
  id: 'model-route',
  title: 'Model route',
  kind: 'recipe',
  question: 'Qual modelo/ferramenta disponível eu uso?',
  summary: 'Escolhe, entre os candidatos, o melhor para a tarefa. Cada candidato vira uma opção da pergunta.',
  primary: 'decision',
  decisions: [],
  fields: [
    { key: 'task', label: 'Tarefa', kind: 'textarea', required: true },
    {
      key: 'candidates',
      label: 'Candidatos',
      kind: 'candidates',
      required: true,
      minItems: 2,
      help: 'Mínimo 2. "Extra" aceita JSON com propriedades adicionais, ex: {"cost":"low"}.',
    },
    { key: 'priorities', label: 'Prioridades', kind: 'list', placeholder: 'quality' },
    { key: 'constraints', label: 'Restrições', kind: 'list' },
    { key: 'stakes', label: 'Impacto', kind: 'enum', options: STAKES },
  ],
  example: {
    task: 'Review a complex dispute with 100k tokens of context and tool use',
    candidates: [
      { id: 'fast-model', description: 'Fast, 32k context', extra: '{"cost":"low"}' },
      { id: 'reasoning-model', description: 'Strong reasoning, 200k context', extra: '{"cost":"high"}' },
    ],
    priorities: ['quality', 'context'],
    constraints: [],
    stakes: 'high',
  },
  compile: (b) => {
    const criteria: Record<string, Description> = {};
    for (const c of (b.candidates as Record<string, unknown>[] | undefined) ?? []) {
      const { id, ...rest } = c;
      criteria[String(id)] = Object.keys(rest).length ? rest : String(id);
    }
    return {
      state: compact({ task: b.task, priorities: b.priorities, constraints: b.constraints, stakes: b.stakes }),
      questions: {
        decision: {
          type: 'choice',
          instructions: 'Choose the candidate best suited to this task, given its priorities, constraints and stakes.',
          criteria,
        },
      },
    };
  },
};

export const research: Preset = {
  id: 'research',
  title: 'Research',
  kind: 'recipe',
  question: 'As evidências sustentam esta afirmação?',
  summary: 'Julga se as evidências fornecidas sustentam uma afirmação. O modelo não navega na web.',
  primary: 'decision',
  decisions: ['accept', 'verify_more', 'reject'],
  fields: [
    { key: 'claim', label: 'Afirmação', kind: 'textarea', required: true },
    { key: 'evidence', label: 'Evidências', kind: 'list' },
    { key: 'source_quality', label: 'Qualidade das fontes', kind: 'enum', options: ['low', 'mixed', 'high'] },
    { key: 'stakes', label: 'Impacto', kind: 'enum', options: STAKES },
  ],
  example: {
    claim: 'This order qualifies for an expedited refund under the policy',
    evidence: ['Order arrived three days late', 'Policy: late deliveries over 2 days get expedited refunds'],
    source_quality: 'mixed',
    stakes: 'medium',
  },
  compile: (b) => ({
    state: compact({ claim: b.claim, evidence: b.evidence, source_quality: b.source_quality, stakes: b.stakes }),
    questions: {
      decision: {
        type: 'choice',
        instructions: 'Judge whether the evidence given supports the claim. Use only the evidence provided.',
        criteria: {
          accept: 'The evidence directly and sufficiently supports the claim.',
          verify_more: 'The evidence is partial, indirect or mixed: more verification is needed.',
          reject: 'The evidence contradicts the claim or clearly fails to support it.',
        },
      },
      evidence_strength: {
        type: 'score',
        instructions: 'How strong is the evidence for the claim?',
        criteria: ['None', 'Weak', 'Moderate', 'Strong'],
      },
    },
  }),
};

export const completion: Preset = {
  id: 'completion',
  title: 'Completion',
  kind: 'recipe',
  question: 'Está realmente pronto para dizer que terminei?',
  summary: 'Verifica se um objetivo está completo antes de reportar sucesso.',
  primary: 'decision',
  decisions: ['complete', 'verify_more', 'incomplete'],
  fields: [
    { key: 'objective', label: 'Objetivo', kind: 'textarea', required: true },
    { key: 'completed_work', label: 'Trabalho concluído', kind: 'list' },
    { key: 'verification', label: 'Verificações feitas', kind: 'list' },
    { key: 'known_gaps', label: 'Lacunas conhecidas', kind: 'list' },
  ],
  example: {
    objective: "Resolve a customer's duplicate-charge report",
    completed_work: ['Matched both charges to the same order'],
    verification: ['Customer identity and charge records verified'],
    known_gaps: ['Refund has not been approved or issued'],
  },
  compile: (b) => ({
    state: compact({
      objective: b.objective,
      completed_work: b.completed_work,
      verification_done: b.verification,
      known_gaps: b.known_gaps,
    }),
    questions: {
      decision: {
        type: 'choice',
        instructions: 'Has the stated objective actually been achieved, based on the work and verification reported?',
        criteria: {
          complete: 'The objective is fully achieved and verified.',
          verify_more: 'Probably done, but important parts are not verified yet.',
          incomplete: 'Key parts of the objective are still missing.',
        },
      },
      safe_to_report: {
        type: 'noul',
        instructions: 'Is it safe to tell the user this objective is done right now?',
      },
    },
  }),
};

export const PRESETS: readonly Preset[] = [toolGuard, route, modelRoute, research, completion, decide];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
