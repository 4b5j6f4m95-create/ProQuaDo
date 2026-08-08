// NextResponse.json() cannot serialize BigInt (e.g. DocumentRevision.fileSizeBytes)
// out of the box. Converting to string preserves precision for very large
// files; a plain Number would lose it above 2^53 bytes (irrelevant at MVP
// scale, but string is free and strictly safer).
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}
