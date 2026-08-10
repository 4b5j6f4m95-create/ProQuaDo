import { pinPolicyViolation } from '../set-confirmation-pin';

/**
 * Die PIN-Regel ohne Datenbank.
 *
 * Der Zweck ist derselbe wie beim Backoff-Test in confirm-with-pin: die Zahl
 * dahinter ist das Argument. Vier Ziffern sind 10 000 Möglichkeiten; wer
 * `1111` und `1234` zulässt, gibt die beiden Muster frei, die erfahrungsgemäß
 * die halbe Schicht wählt — und dann nützt die Fehlversuchssperre wenig, weil
 * der erste Rateversuch trifft.
 *
 * Bewusst NICHT geprüft wird eine lange Verbotsliste. Sie verschiebt nur,
 * welche schwache Wahl übrig bleibt, und kostet bei jeder Ergänzung einen
 * Test, der nichts Neues sagt.
 */

describe('pinPolicyViolation', () => {
  it('nimmt eine unauffällige PIN an', () => {
    expect(pinPolicyViolation('4071')).toBeNull();
    expect(pinPolicyViolation('918273')).toBeNull();
    expect(pinPolicyViolation('530298471')).toBeNull();
  });

  it('verlangt 4 bis 12 Ziffern', () => {
    expect(pinPolicyViolation('123')).toMatch(/4 bis 12/);
    expect(pinPolicyViolation('1234567890123')).toMatch(/4 bis 12/);
    expect(pinPolicyViolation('')).toMatch(/4 bis 12/);
  });

  it('weist alles zurück, was keine reine Ziffernfolge ist', () => {
    expect(pinPolicyViolation('12a4')).toMatch(/4 bis 12/);
    expect(pinPolicyViolation('12 34')).toMatch(/4 bis 12/);
    expect(pinPolicyViolation('-1234')).toMatch(/4 bis 12/);
  });

  it('weist eine einzige wiederholte Ziffer zurück', () => {
    expect(pinPolicyViolation('1111')).toMatch(/einzigen Ziffer/);
    expect(pinPolicyViolation('000000')).toMatch(/einzigen Ziffer/);
  });

  it('weist fortlaufende Folgen in beide Richtungen zurück', () => {
    expect(pinPolicyViolation('1234')).toMatch(/fortlaufende/);
    expect(pinPolicyViolation('4321')).toMatch(/fortlaufende/);
    expect(pinPolicyViolation('345678')).toMatch(/fortlaufende/);
  });

  it('hält eine Folge mit einem Sprung für zulässig', () => {
    // 1235 ist keine Folge — die Regel darf nicht auf "beginnt wie 123"
    // anspringen, sonst verbietet sie mehr, als sie begründen kann.
    expect(pinPolicyViolation('1235')).toBeNull();
    expect(pinPolicyViolation('4322')).toBeNull();
  });

  it('erklärt, warum die Demo-PIN aus dem Seed hier nicht durchkommt', () => {
    // Der Seed schreibt den Hash unmittelbar und umgeht diese Regel; er ist
    // ausdrücklich nur für Demo und Test. Wer in einer Schulung `1234` tippt,
    // bekommt hier eine Absage — das ist gewollt und steht so in docs/15.
    expect(pinPolicyViolation('1234')).not.toBeNull();
  });
});
