import { Prisma } from '@prisma/client';
import { ValidationError } from './domain-errors';

/**
 * Parses a human-entered numeric string into an exact Decimal.
 *
 * Two deliberate choices: values travel as strings so binary floating point
 * never touches a measured value or a tolerance limit, and a decimal COMMA
 * is accepted — the UI is German and a worker on a tablet types "2,1". A
 * value rejected here is a validation error the user can fix, never a
 * silently coerced 0.
 */
export function parseDecimalInput(value: string, label: string): Prisma.Decimal {
  const normalized = value.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new ValidationError(`${label}: "${value}" ist kein gültiger Zahlenwert.`);
  }
  return new Prisma.Decimal(normalized);
}
