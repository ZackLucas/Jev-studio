import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getPreset, type Scenario, type ScenarioInput } from '@jev/core';
import type { ScenarioRepo } from '../ports';
import { AppError, notFound } from './errors';

const inputSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao cenário.').max(120),
  presetId: z.string().refine((id) => Boolean(getPreset(id)), 'Preset desconhecido.'),
  body: z.record(z.unknown()),
  raw: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

/** Use cases for saved scenarios (named, reusable request bodies). */
export class ScenarioService {
  constructor(private readonly repo: ScenarioRepo) {}

  list(): Promise<Scenario[]> {
    return this.repo.list();
  }

  async get(id: string): Promise<Scenario> {
    const s = await this.repo.get(id);
    if (!s) throw notFound('Cenário');
    return s;
  }

  private parse(input: unknown): ScenarioInput {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_SCENARIO', parsed.error.issues[0]?.message ?? 'Cenário inválido.');
    }
    return parsed.data;
  }

  async create(input: unknown): Promise<Scenario> {
    const data = this.parse(input);
    const now = new Date().toISOString();
    const scenario: Scenario = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
    await this.repo.upsert(scenario);
    return scenario;
  }

  async update(id: string, input: unknown): Promise<Scenario> {
    const current = await this.get(id);
    const data = this.parse(input);
    const scenario: Scenario = { ...current, ...data, updatedAt: new Date().toISOString() };
    await this.repo.upsert(scenario);
    return scenario;
  }

  async remove(id: string): Promise<void> {
    if (!(await this.repo.remove(id))) throw notFound('Cenário');
  }
}
