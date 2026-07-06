import { readFileSync } from 'fs';
import { join } from 'path';

let cached: string | null = null;

/** App-Version aus server/package.json (wird vom Changelog-Bot/Pull gebumpt). */
export function appVersion(): string {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    cached = pkg.version || '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached as string;
}
