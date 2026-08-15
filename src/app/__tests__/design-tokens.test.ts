import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Kontrastzusagen aus `globals.css` — nachgerechnet statt behauptet.
 *
 * **Warum dieser Test existiert.** Der Kopfkommentar von `globals.css` sagt
 * seit der ersten Fassung „Text mindestens 4,5:1, UI-Kanten mindestens 3:1".
 * Die Textfarben hielten das mit großer Reserve; `--border-strong` hielt es
 * **nicht** — `#b3bdcd` ergibt gegen Weiß 1,90:1. Knöpfe und Eingabefelder
 * sind weiß auf weißer Karte, die Kante ist also das Einzige, was sie
 * überhaupt als Bedienelement erkennbar macht (WCAG 2.2 SC 1.4.11).
 *
 * **Gefunden wurde das durch Nachrechnen, nicht durch eine Prüfung.** Die
 * axe-Läufe waren die ganze Zeit grün: SC 1.4.11 ist für selbstgezeichnete
 * Kanten maschinell nicht entscheidbar — axe weiß nicht, ob eine Linie ein
 * Bedienelement begrenzt oder eine Karte schmückt. Dieser Test weiß es,
 * weil hier steht, welches Token wofür da ist.
 *
 * Er liest die **echte Datei**, nicht eine Kopie der Werte. Eine Tabelle mit
 * abgeschriebenen Farben prüfte sich selbst und nicht die Anwendung.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf-8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(CSS);
  if (!match) {
    throw new Error(
      `Token --${name} nicht in globals.css gefunden. Wurde es umbenannt? ` +
        'Dann gehört dieser Test mit umbenannt und nicht gelöscht.',
    );
  }
  return match[1]!.toLowerCase();
}

/** Relative Leuchtdichte nach WCAG 2.x. */
function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('Design-Token: Kontrast', () => {
  const surfaces = () => ({
    surface: token('surface'),
    sunken: token('surface-sunken'),
    bg: token('bg'),
  });

  /**
   * Der Fall, um dessentwillen es diesen Test gibt. Ein Bedienelement liegt
   * auf jeder der drei Flächen vor — ein Knopf in einer Karte, einer im
   * eingesenkten Formularbereich, einer direkt auf dem Seitenhintergrund.
   * Alle drei müssen die Marke halten, nicht nur der bequemste.
   */
  it('--border-strong hält 3:1 gegen jede Fläche — es begrenzt Bedienelemente', () => {
    const strong = token('border-strong');
    for (const [name, background] of Object.entries(surfaces())) {
      expect({ fläche: name, verhältnis: Number(ratio(strong, background).toFixed(2)) }).toEqual({
        fläche: name,
        verhältnis: expect.any(Number),
      });
      expect(ratio(strong, background)).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * Die Gegenprobe zur Regel oben: `--border` ist ausdrücklich **kein**
   * Bedienelementrand, sondern Kartenkante und Tabellenlinie. Für die
   * verlangt SC 1.4.11 nichts. Der Test hält das fest, damit niemand sie
   * „zur Sicherheit" mit anhebt und die Oberfläche schwer macht — und damit
   * umgekehrt auffällt, wenn jemand sie an einem Knopf verwendet.
   */
  it('--border bleibt eine Trennlinie und wird nicht auf Bedienelemente gehoben', () => {
    expect(ratio(token('border'), token('surface'))).toBeLessThan(3);
  });

  it.each([
    ['--text auf --surface', 'text', 'surface'],
    ['--text auf --bg', 'text', 'bg'],
    ['--text-muted auf --surface', 'text-muted', 'surface'],
    ['--text-muted auf --bg', 'text-muted', 'bg'],
    ['--text-muted auf --surface-sunken', 'text-muted', 'surface-sunken'],
    ['--brand auf --surface', 'brand', 'surface'],
    ['--brand auf --brand-weak', 'brand', 'brand-weak'],
    ['--danger auf --surface', 'danger', 'surface'],
    ['--success auf --surface', 'success', 'surface'],
    ['--warning auf --surface', 'warning', 'surface'],
  ])('%s hält 4,5:1', (_label, foreground, background) => {
    expect(ratio(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  /** Weiß auf der Markenfarbe ist die Beschriftung des Hauptknopfes. */
  it('Weiß auf --brand hält 4,5:1', () => {
    expect(ratio('#ffffff', token('brand'))).toBeGreaterThanOrEqual(4.5);
  });
});
