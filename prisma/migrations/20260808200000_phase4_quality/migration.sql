-- DropIndex
DROP INDEX "completion_submissions_work_step_instance_id_key";

-- DropIndex
DROP INDEX "work_step_instances_organization_id_production_order_id_pla_key";

-- AlterTable
ALTER TABLE "measurement_results" ADD COLUMN     "calibration_id" TEXT,
ADD COLUMN     "measuring_equipment_id" TEXT;

-- AlterTable
ALTER TABLE "work_step_instances" ADD COLUMN     "attempt_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "non_conformance_id" TEXT,
ADD COLUMN     "origin_work_step_instance_id" TEXT,
ADD COLUMN     "step_kind" TEXT NOT NULL DEFAULT 'PRODUCTION';

-- CreateTable
CREATE TABLE "non_conformances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "ncr_number" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT,
    "inspection_characteristic_id" TEXT,
    "batch_number" TEXT,
    "serial_number" TEXT,
    "description" TEXT NOT NULL,
    "error_category" TEXT,
    "discovered_location" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL,
    "discovered_by_id" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "is_blocking" BOOLEAN NOT NULL DEFAULT false,
    "assigned_to_id" TEXT,
    "due_date" DATE,
    "immediate_action" TEXT,
    "assessment_notes" TEXT,
    "root_cause" TEXT,
    "disposition_type" TEXT,
    "disposition_reason" TEXT,
    "disposition_by_id" TEXT,
    "disposition_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "non_conformances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_conformance_evidence" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "non_conformance_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "description" TEXT,
    "mime_type" TEXT,
    "file_hash_sha256" TEXT,
    "file_size_bytes" BIGINT,
    "malware_scan_status" TEXT,
    "upload_status" TEXT NOT NULL DEFAULT 'PENDING',
    "captured_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "non_conformance_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_holds" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "project_id" TEXT,
    "production_order_id" TEXT,
    "serial_number" TEXT,
    "work_step_instance_id" TEXT,
    "non_conformance_id" TEXT,
    "hold_reason" TEXT NOT NULL,
    "release_condition" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "issued_by_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "release_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "production_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measuring_equipment" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "equipment_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "measurement_range_min" DECIMAL(20,6),
    "measurement_range_max" DECIMAL(20,6),
    "measurement_unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "measuring_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibrations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "measuring_equipment_id" TEXT NOT NULL,
    "calibrated_at" TIMESTAMP(3) NOT NULL,
    "next_calibration_due_at" TIMESTAMP(3) NOT NULL,
    "calibrated_by" TEXT,
    "calibration_certificate_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "invalidated_at" TIMESTAMP(3),
    "invalidated_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "non_conformances_organization_id_idx" ON "non_conformances"("organization_id");

-- CreateIndex
CREATE INDEX "non_conformances_organization_id_status_idx" ON "non_conformances"("organization_id", "status");

-- CreateIndex
CREATE INDEX "non_conformances_production_order_id_idx" ON "non_conformances"("production_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "non_conformances_organization_id_ncr_number_key" ON "non_conformances"("organization_id", "ncr_number");

-- CreateIndex
CREATE INDEX "non_conformance_evidence_organization_id_idx" ON "non_conformance_evidence"("organization_id");

-- CreateIndex
CREATE INDEX "non_conformance_evidence_non_conformance_id_idx" ON "non_conformance_evidence"("non_conformance_id");

-- CreateIndex
CREATE INDEX "production_holds_organization_id_idx" ON "production_holds"("organization_id");

-- CreateIndex
CREATE INDEX "production_holds_organization_id_is_active_idx" ON "production_holds"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "production_holds_production_order_id_is_active_idx" ON "production_holds"("production_order_id", "is_active");

-- CreateIndex
CREATE INDEX "measuring_equipment_organization_id_idx" ON "measuring_equipment"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "measuring_equipment_organization_id_equipment_number_key" ON "measuring_equipment"("organization_id", "equipment_number");

-- CreateIndex
CREATE INDEX "calibrations_organization_id_idx" ON "calibrations"("organization_id");

-- CreateIndex
CREATE INDEX "calibrations_measuring_equipment_id_next_calibration_due_at_idx" ON "calibrations"("measuring_equipment_id", "next_calibration_due_at");

-- CreateIndex
CREATE INDEX "completion_submissions_work_step_instance_id_created_at_idx" ON "completion_submissions"("work_step_instance_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_step_instances_organization_id_production_order_id_pla_key" ON "work_step_instances"("organization_id", "production_order_id", "plan_step_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "work_step_instances" ADD CONSTRAINT "work_step_instances_origin_work_step_instance_id_fkey" FOREIGN KEY ("origin_work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_step_instances" ADD CONSTRAINT "work_step_instances_non_conformance_id_fkey" FOREIGN KEY ("non_conformance_id") REFERENCES "non_conformances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_measuring_equipment_id_fkey" FOREIGN KEY ("measuring_equipment_id") REFERENCES "measuring_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_calibration_id_fkey" FOREIGN KEY ("calibration_id") REFERENCES "calibrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_inspection_characteristic_id_fkey" FOREIGN KEY ("inspection_characteristic_id") REFERENCES "inspection_characteristics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_evidence" ADD CONSTRAINT "non_conformance_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformance_evidence" ADD CONSTRAINT "non_conformance_evidence_non_conformance_id_fkey" FOREIGN KEY ("non_conformance_id") REFERENCES "non_conformances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_holds" ADD CONSTRAINT "production_holds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_holds" ADD CONSTRAINT "production_holds_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_holds" ADD CONSTRAINT "production_holds_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_holds" ADD CONSTRAINT "production_holds_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_holds" ADD CONSTRAINT "production_holds_non_conformance_id_fkey" FOREIGN KEY ("non_conformance_id") REFERENCES "non_conformances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measuring_equipment" ADD CONSTRAINT "measuring_equipment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_measuring_equipment_id_fkey" FOREIGN KEY ("measuring_equipment_id") REFERENCES "measuring_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

