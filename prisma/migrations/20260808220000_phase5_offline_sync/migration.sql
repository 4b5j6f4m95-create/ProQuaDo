-- Phase 5: Offline und Synchronisation (docs/06_OFFLINE_SYNC_CONFLICT.md).
--
-- Two of the columns below land on tables that already hold data, so they
-- are added nullable, backfilled and only then made NOT NULL:
--
--   devices.organization_id  — closes the gap the Phase 1 RLS migration
--     documented ("devices and sessions intentionally have NO
--     organization_id ... until a dedicated policy is designed"). The sync
--     API is the first consumer, so the policy is designed now.
--   outbox_events.sequence   — the per-organization cursor of GET
--     /sync/changes. Existing events are numbered by creation order so an
--     already-running installation keeps a consistent stream.

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "last_sync_at" TIMESTAMP(3),
ADD COLUMN     "organization_id" TEXT,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "revoked_by_id" TEXT,
ADD COLUMN     "revoked_reason" TEXT;

-- A device belongs to exactly the organization of the user it is bound to.
UPDATE "devices" d SET "organization_id" = u."organization_id"
  FROM "users" u WHERE u."id" = d."user_id";
ALTER TABLE "devices" ALTER COLUMN "organization_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "sequence" BIGINT;

-- Number existing events per organization in creation order; id breaks ties
-- so the numbering is deterministic if two events share a timestamp.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (
           PARTITION BY "organization_id" ORDER BY "created_at", "id"
         ) AS seq
    FROM "outbox_events"
)
UPDATE "outbox_events" e SET "sequence" = n.seq FROM numbered n WHERE n."id" = e."id";
ALTER TABLE "outbox_events" ALTER COLUMN "sequence" SET NOT NULL;

-- AlterTable
ALTER TABLE "photo_evidence" ADD COLUMN     "chunk_count" INTEGER,
ADD COLUMN     "chunk_size_bytes" INTEGER,
ADD COLUMN     "declared_size_bytes" BIGINT,
ADD COLUMN     "upload_mode" TEXT NOT NULL DEFAULT 'SINGLE';

-- CreateTable
CREATE TABLE "sync_sequences" (
    "organization_id" TEXT NOT NULL,
    "last_sequence" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_sequences_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "last_cursor" BIGINT NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_commands" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "client_timestamp" TIMESTAMP(3) NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "base_version" INTEGER,
    "status" TEXT NOT NULL,
    "conflict_type" TEXT,
    "result_payload" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sync_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conflict_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sync_command_id" TEXT,
    "production_order_id" TEXT,
    "work_step_instance_id" TEXT,
    "completion_submission_id" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sync_conflict_id" TEXT NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "decision_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resulting_action" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_upload_chunks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "photo_evidence_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "chunk_hash_sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_upload_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_cursors_organization_id_idx" ON "sync_cursors"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_organization_id_user_id_device_id_key" ON "sync_cursors"("organization_id", "user_id", "device_id");

-- CreateIndex
CREATE INDEX "sync_commands_organization_id_status_idx" ON "sync_commands"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sync_commands_organization_id_device_id_sequence_number_idx" ON "sync_commands"("organization_id", "device_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "sync_commands_organization_id_device_id_idempotency_key_key" ON "sync_commands"("organization_id", "device_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sync_conflicts_organization_id_status_idx" ON "sync_conflicts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "sync_conflicts_organization_id_work_step_instance_id_idx" ON "sync_conflicts"("organization_id", "work_step_instance_id");

-- CreateIndex
CREATE INDEX "conflict_decisions_organization_id_sync_conflict_id_idx" ON "conflict_decisions"("organization_id", "sync_conflict_id");

-- CreateIndex
CREATE INDEX "photo_upload_chunks_organization_id_idx" ON "photo_upload_chunks"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "photo_upload_chunks_organization_id_photo_evidence_id_chunk_key" ON "photo_upload_chunks"("organization_id", "photo_evidence_id", "chunk_index");

-- CreateIndex
CREATE INDEX "devices_organization_id_is_revoked_idx" ON "devices"("organization_id", "is_revoked");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_organization_id_sequence_key" ON "outbox_events"("organization_id", "sequence");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_sequences" ADD CONSTRAINT "sync_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_sync_command_id_fkey" FOREIGN KEY ("sync_command_id") REFERENCES "sync_commands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_decisions" ADD CONSTRAINT "conflict_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_decisions" ADD CONSTRAINT "conflict_decisions_sync_conflict_id_fkey" FOREIGN KEY ("sync_conflict_id") REFERENCES "sync_conflicts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_upload_chunks" ADD CONSTRAINT "photo_upload_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_upload_chunks" ADD CONSTRAINT "photo_upload_chunks_photo_evidence_id_fkey" FOREIGN KEY ("photo_evidence_id") REFERENCES "photo_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Seed the counter for every existing organization so the first Phase 5
-- outbox write continues the numbering instead of colliding with it.
INSERT INTO "sync_sequences" ("organization_id", "last_sequence", "updated_at")
SELECT o."id", COALESCE(MAX(e."sequence"), 0), now()
  FROM "organizations" o
  LEFT JOIN "outbox_events" e ON e."organization_id" = o."id"
 GROUP BY o."id";
