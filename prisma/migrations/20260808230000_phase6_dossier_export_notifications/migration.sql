-- CreateTable
CREATE TABLE "production_dossiers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "dossier_number" TEXT NOT NULL,
    "serial_number" TEXT,
    "template_version" TEXT NOT NULL,
    "data_as_of" TIMESTAMP(3) NOT NULL,
    "generated_by_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "production_dossiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dossier_exports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_dossier_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "file_hash_sha256" TEXT,
    "file_size_bytes" BIGINT,
    "manifest" JSONB,
    "entry_count" INTEGER,
    "failure_reason" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "dossier_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "resource_type" TEXT,
    "resource_id" TEXT,
    "link_path" TEXT,
    "source_event_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_dossiers_organization_id_production_order_id_idx" ON "production_dossiers"("organization_id", "production_order_id");

-- CreateIndex
CREATE INDEX "production_dossiers_organization_id_serial_number_idx" ON "production_dossiers"("organization_id", "serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_dossiers_organization_id_dossier_number_key" ON "production_dossiers"("organization_id", "dossier_number");

-- CreateIndex
CREATE INDEX "dossier_exports_organization_id_status_idx" ON "dossier_exports"("organization_id", "status");

-- CreateIndex
CREATE INDEX "dossier_exports_production_dossier_id_created_at_idx" ON "dossier_exports"("production_dossier_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_user_id_read_at_idx" ON "notifications"("organization_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_user_id_source_event_id_key" ON "notifications"("organization_id", "user_id", "source_event_id");

-- AddForeignKey
ALTER TABLE "production_dossiers" ADD CONSTRAINT "production_dossiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_dossiers" ADD CONSTRAINT "production_dossiers_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier_exports" ADD CONSTRAINT "dossier_exports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossier_exports" ADD CONSTRAINT "dossier_exports_production_dossier_id_fkey" FOREIGN KEY ("production_dossier_id") REFERENCES "production_dossiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

