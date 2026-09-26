import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from src/ (tsx): one level under apps/api.
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STUDIO_ROOT = path.resolve(apiDir, '../..');
export const WEB_DIST = path.join(STUDIO_ROOT, 'apps/web/dist');
export const DATA_DIR = process.env.JEV_STUDIO_DATA ?? path.join(STUDIO_ROOT, 'data');
export const JEFF_COMPOSE_FILE = path.join(STUDIO_ROOT, 'docker/jeff/compose.yml');
