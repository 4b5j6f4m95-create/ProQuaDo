// The resolved identity of whoever is invoking a domain service — always
// explicit, never re-derived from a global session inside the service. API
// routes resolve this once via requireAuthContext() (see
// src/lib/authz/require-permission.ts) and pass it through; integration
// tests construct it directly from seeded fixtures. This is what makes
// domain services testable with arbitrary actors, not just "whoever is
// logged in right now".
export interface Actor {
  userId: string;
  organizationId: string;
}
