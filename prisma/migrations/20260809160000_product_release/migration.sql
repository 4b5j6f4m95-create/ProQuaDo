-- Produktfreigabe als eigener Vorgang.
--
-- Masterprompt Kap. 10 names "Endprüfung und Produktfreigabe" as section 9 of
-- the dossier. Until now the section only computed whether anything was still
-- open and said so in plain words — deliberately, because presenting
-- "completed with nothing open" as "released" would have been the dossier
-- inventing a decision nobody made. This table is that decision.

CREATE TABLE product_releases (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT        NOT NULL REFERENCES organizations (id),
  production_order_id       TEXT        NOT NULL REFERENCES production_orders (id),
  decision                  TEXT        NOT NULL,
  decided_by_id             TEXT        NOT NULL,
  decided_at                TIMESTAMPTZ NOT NULL,
  reason                    TEXT        NOT NULL,
  basis_order_status        TEXT        NOT NULL,
  basis_open_blocking_ncrs  INTEGER     NOT NULL,
  basis_active_holds        INTEGER     NOT NULL,
  basis_completed_steps     INTEGER     NOT NULL,
  basis_total_steps         INTEGER     NOT NULL,
  confirmation_text         TEXT        NOT NULL,
  confirmation_text_version TEXT        NOT NULL,
  signature_data            TEXT        NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  version                   INTEGER     NOT NULL DEFAULT 1
);

CREATE INDEX product_releases_organization_id_idx ON product_releases (organization_id);
CREATE INDEX product_releases_order_decided_idx
  ON product_releases (production_order_id, decided_at);

ALTER TABLE product_releases
  ADD CONSTRAINT product_releases_decision_known
  CHECK (decision IN ('RELEASED', 'REJECTED'));

-- A decision without a stated reason is a signature on a blank page. Required
-- for a release just as much as for a rejection: "why was this product
-- released" is the question an audit actually asks.
ALTER TABLE product_releases
  ADD CONSTRAINT product_releases_reason_not_empty
  CHECK (length(btrim(reason)) > 0);

-- At most ONE release per order, while rejections may repeat.
--
-- This is the shape the workflow needs: rejected → rework → released is the
-- ordinary course of events, so the table cannot be one row per order. But a
-- product must not be released twice, and an existing release must not be
-- quietly superseded by a second one — a partial unique index says exactly
-- that, in the database, rather than only in the service.
CREATE UNIQUE INDEX product_releases_one_release_per_order
  ON product_releases (production_order_id)
  WHERE decision = 'RELEASED';

GRANT SELECT, INSERT, UPDATE, DELETE ON product_releases TO proquado_app;

ALTER TABLE product_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_releases_isolation ON product_releases
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
