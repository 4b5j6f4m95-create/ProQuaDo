-- ERP-/Webhook-Anbindung — docs/10 Phase 6, dort als „Implementierung
-- optional für MVP" geführt.
--
-- Zugestellt wird aus der Outbox, dem Strom, den write-outbox-event.ts seit
-- Phase 1 als Quelle für „future webhooks" benennt. Bewusst NICHT über deren
-- `processed`-Flag: das ist die Wasserstandsmarke des Benachrichtigungs-
-- versands, und ein zweiter Verbraucher daran würde dem ersten Ereignisse
-- wegnehmen, die er noch nicht gesehen hat. Jedes Abonnement führt seinen
-- eigenen Cursor.

CREATE TABLE webhook_subscriptions (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT        NOT NULL REFERENCES organizations (id),
  name             TEXT        NOT NULL,
  url              TEXT        NOT NULL,
  secret           TEXT        NOT NULL,
  event_types      TEXT[]      NOT NULL DEFAULT '{}',
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  cursor           BIGINT      NOT NULL DEFAULT 0,
  created_by_id    TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version          INTEGER     NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX webhook_subscriptions_org_name_unique
  ON webhook_subscriptions (organization_id, name);
CREATE INDEX webhook_subscriptions_org_active_idx
  ON webhook_subscriptions (organization_id, is_active);

-- Ein Endpunkt ohne https ist in Produktion kein Endpunkt: die Nutzlast trägt
-- Auftrags- und Prüfdaten, und die Signatur schützt ihre Echtheit, nicht ihre
-- Vertraulichkeit. http bleibt zugelassen, weil die lokale Entwicklung sonst
-- nicht testbar wäre — der Dienst lehnt es in Produktion zusätzlich ab
-- (siehe safe-url.ts).
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_url_scheme
  CHECK (url ~ '^https?://');

-- Ein Cursor, der rückwärts laufen kann, ist kein Cursor.
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_cursor_not_negative CHECK (cursor >= 0);

CREATE TABLE webhook_deliveries (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT        NOT NULL REFERENCES organizations (id),
  subscription_id  TEXT        NOT NULL REFERENCES webhook_subscriptions (id),
  outbox_event_id  TEXT        NOT NULL,
  event_type       TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'PENDING',
  attempts         INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at  TIMESTAMPTZ,
  response_status  INTEGER,
  failure_reason   TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dieselbe Zustellung entsteht nie zweimal. Das ist der Grund, warum ein
-- wiederholter Auslauf harmlos ist — nicht Sorgfalt im Code, sondern der
-- Index.
CREATE UNIQUE INDEX webhook_deliveries_subscription_event_unique
  ON webhook_deliveries (subscription_id, outbox_event_id);
CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries (organization_id, status, next_attempt_at);

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_status_known
  CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED'));

-- Eine zugestellte Zeile muss sagen können, wann. Eine gescheiterte, warum.
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_delivered_has_timestamp
  CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL);
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_failed_has_reason
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_subscriptions, webhook_deliveries TO proquado_app;

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_subscriptions_isolation ON webhook_subscriptions
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_isolation ON webhook_deliveries
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
