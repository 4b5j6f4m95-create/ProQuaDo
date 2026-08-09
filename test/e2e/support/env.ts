import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lädt die lokale `.env` in `process.env`, ohne eine Abhängigkeit dafür
 * aufzunehmen. Nötig, weil die E2E-Tests zwei Dinge tun, die Next.js' eigenes
 * Env-Laden nicht abdeckt: sie sprechen die Datenbank direkt an (Fixtures) und
 * sie starten den Server als Unterprozess.
 *
 * Bewusst simpel — `KEY="value"` und `KEY=value`, Kommentare, Leerzeilen. Wer
 * hier mehr braucht, sollte lieber prüfen, ob die Variable wirklich in die
 * `.env` gehört. Bereits gesetzte Variablen werden **nicht** überschrieben:
 * ein Aufrufer, der `DATABASE_URL` mitgibt, meint das so.
 */
export function loadDotEnv(file = '.env'): void {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return; // Keine .env — in CI kommen die Werte aus der Umgebung.
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
