import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JeffVariant } from '@jev/core';

// Works from src/ (tsx): one level under apps/api.
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STUDIO_ROOT = path.resolve(apiDir, '../..');
export const WEB_DIST = path.join(STUDIO_ROOT, 'apps/web/dist');
export const DATA_DIR = process.env.JEV_STUDIO_DATA ?? path.join(STUDIO_ROOT, 'data');

/** One compose file (and image) per variant; the Studio picks one through jeff.device. */
export const JEFF_COMPOSE_FILES: Record<JeffVariant, string> = {
  cpu: path.join(STUDIO_ROOT, 'docker/jeff/cpu/compose.yml'),
  gpu: path.join(STUDIO_ROOT, 'docker/jeff/gpu/compose.yml'),
};

/** Image tag must match the `image:` in the matching compose file. */
export const jeffImage = (variant: JeffVariant): string => `jev-studio-jeff:${variant}`;
