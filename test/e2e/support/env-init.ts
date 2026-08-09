import { loadDotEnv } from './env';

// Muss als **erster** Import einer Datei stehen, die Anwendungsmodule zieht:
// `@/lib/db/client` liest DATABASE_URL beim Auswerten des Moduls, und
// ES-Module werden in der Reihenfolge ihrer Import-Deklarationen ausgewertet.
loadDotEnv();
