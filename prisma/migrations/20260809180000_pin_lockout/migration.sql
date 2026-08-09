-- PIN-Fehlversuchssperre.
--
-- ADR-005 named this as the most obvious gap in the chosen signature method:
-- a four-digit PIN has 10 000 combinations, and until now the only thing
-- between an attacker with a valid session and every one of them was the
-- STANDARD_API ceiling of 100 requests per minute. That is roughly two
-- minutes of guessing.
--
-- Counted per USER rather than per request, because that is what the attack
-- targets. Note who can raise the counter: the PIN is verified for the
-- authenticated actor, so only the holder of a session can produce failures
-- on that account. There is deliberately no way to lock a colleague out.
ALTER TABLE users
  ADD COLUMN confirmation_pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN confirmation_pin_locked_until    TIMESTAMPTZ;

-- A negative count would mean the reset logic ran backwards.
ALTER TABLE users
  ADD CONSTRAINT users_confirmation_pin_failed_attempts_not_negative
  CHECK (confirmation_pin_failed_attempts >= 0);
