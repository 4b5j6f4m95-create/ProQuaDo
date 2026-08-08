-- AlterTable
ALTER TABLE "users" ADD COLUMN     "confirmation_pin_hash" TEXT;

-- CreateTable
CREATE TABLE "inspection_characteristics" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_step_id" TEXT NOT NULL,
    "characteristic_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nominal_value" DECIMAL(20,6),
    "lower_limit" DECIMAL(20,6),
    "upper_limit" DECIMAL(20,6),
    "unit" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "requires_measuring_equipment" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inspection_characteristics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_requirements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_step_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "min_count" INTEGER NOT NULL DEFAULT 1,
    "max_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "photo_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "production_plan_revision_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "batch_number" TEXT,
    "serial_number" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "planned_start_at" TIMESTAMP(3),
    "planned_end_at" TIMESTAMP(3),
    "actual_start_at" TIMESTAMP(3),
    "actual_end_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "released_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assignments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT,
    "assigned_by_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_step_instances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "production_order_id" TEXT NOT NULL,
    "plan_step_id" TEXT NOT NULL,
    "step_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "started_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "work_step_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_step_releases" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "released_by_id" TEXT NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token_hash" TEXT NOT NULL,
    "token_nonce" TEXT NOT NULL,
    "valid_until" TIMESTAMP(3),
    "plan_revision_hash" TEXT NOT NULL,
    "document_set_hash" TEXT NOT NULL,
    "requirements_hash" TEXT NOT NULL,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "work_step_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completion_submissions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "client_completed_at" TIMESTAMP(3),
    "device_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VALIDATION',
    "validation_status" TEXT,
    "validation_reason" TEXT,
    "validated_at" TIMESTAMP(3),
    "validated_by_id" TEXT,
    "used_plan_revision_id" TEXT NOT NULL,
    "used_document_revision_ids" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "completion_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_confirmations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "confirmed_by_id" TEXT NOT NULL,
    "confirmation_text" TEXT NOT NULL,
    "confirmation_text_version" TEXT NOT NULL,
    "signature_method" TEXT NOT NULL,
    "signature_data" TEXT NOT NULL,
    "device_id" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "step_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_responses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "checklist_item_id" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "comment" TEXT,
    "responded_by_id" TEXT NOT NULL,
    "responded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "checklist_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_results" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "inspection_characteristic_id" TEXT NOT NULL,
    "measured_value" DECIMAL(20,6) NOT NULL,
    "measured_unit" TEXT,
    "lower_limit" DECIMAL(20,6),
    "upper_limit" DECIMAL(20,6),
    "is_within_tolerance" BOOLEAN NOT NULL DEFAULT false,
    "measuring_equipment_ref" TEXT,
    "measured_by_id" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "measurement_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_evidence" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "photo_requirement_id" TEXT,
    "photo_category" TEXT,
    "description" TEXT,
    "storage_key" TEXT NOT NULL,
    "file_hash_sha256" TEXT,
    "file_size_bytes" BIGINT,
    "mime_type" TEXT,
    "malware_scan_status" TEXT,
    "upload_status" TEXT NOT NULL DEFAULT 'PENDING',
    "taken_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3),
    "captured_by_id" TEXT NOT NULL,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "photo_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "second_approvals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_step_instance_id" TEXT NOT NULL,
    "executor_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "reviewer_status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewer_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "second_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_characteristics_organization_id_idx" ON "inspection_characteristics"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_characteristics_organization_id_plan_step_id_cha_key" ON "inspection_characteristics"("organization_id", "plan_step_id", "characteristic_number");

-- CreateIndex
CREATE INDEX "photo_requirements_organization_id_idx" ON "photo_requirements"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "photo_requirements_organization_id_plan_step_id_category_key" ON "photo_requirements"("organization_id", "plan_step_id", "category");

-- CreateIndex
CREATE INDEX "production_orders_organization_id_idx" ON "production_orders"("organization_id");

-- CreateIndex
CREATE INDEX "production_orders_organization_id_status_idx" ON "production_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "production_orders_organization_id_serial_number_idx" ON "production_orders"("organization_id", "serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_organization_id_order_number_key" ON "production_orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "order_assignments_organization_id_idx" ON "order_assignments"("organization_id");

-- CreateIndex
CREATE INDEX "order_assignments_user_id_idx" ON "order_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_assignments_organization_id_production_order_id_user__key" ON "order_assignments"("organization_id", "production_order_id", "user_id");

-- CreateIndex
CREATE INDEX "work_step_instances_organization_id_idx" ON "work_step_instances"("organization_id");

-- CreateIndex
CREATE INDEX "work_step_instances_production_order_id_status_idx" ON "work_step_instances"("production_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_step_instances_organization_id_production_order_id_pla_key" ON "work_step_instances"("organization_id", "production_order_id", "plan_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_step_releases_work_step_instance_id_key" ON "work_step_releases"("work_step_instance_id");

-- CreateIndex
CREATE INDEX "work_step_releases_organization_id_idx" ON "work_step_releases"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_step_releases_organization_id_token_nonce_key" ON "work_step_releases"("organization_id", "token_nonce");

-- CreateIndex
CREATE UNIQUE INDEX "completion_submissions_work_step_instance_id_key" ON "completion_submissions"("work_step_instance_id");

-- CreateIndex
CREATE INDEX "completion_submissions_organization_id_idx" ON "completion_submissions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "completion_submissions_organization_id_idempotency_key_key" ON "completion_submissions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "step_confirmations_organization_id_idx" ON "step_confirmations"("organization_id");

-- CreateIndex
CREATE INDEX "step_confirmations_work_step_instance_id_idx" ON "step_confirmations"("work_step_instance_id");

-- CreateIndex
CREATE INDEX "checklist_responses_organization_id_idx" ON "checklist_responses"("organization_id");

-- CreateIndex
CREATE INDEX "checklist_responses_work_step_instance_id_idx" ON "checklist_responses"("work_step_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_responses_organization_id_work_step_instance_id_c_key" ON "checklist_responses"("organization_id", "work_step_instance_id", "checklist_item_id");

-- CreateIndex
CREATE INDEX "measurement_results_organization_id_idx" ON "measurement_results"("organization_id");

-- CreateIndex
CREATE INDEX "measurement_results_work_step_instance_id_idx" ON "measurement_results"("work_step_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_results_organization_id_work_step_instance_id_i_key" ON "measurement_results"("organization_id", "work_step_instance_id", "inspection_characteristic_id");

-- CreateIndex
CREATE INDEX "photo_evidence_organization_id_idx" ON "photo_evidence"("organization_id");

-- CreateIndex
CREATE INDEX "photo_evidence_work_step_instance_id_upload_status_idx" ON "photo_evidence"("work_step_instance_id", "upload_status");

-- CreateIndex
CREATE UNIQUE INDEX "second_approvals_work_step_instance_id_key" ON "second_approvals"("work_step_instance_id");

-- CreateIndex
CREATE INDEX "second_approvals_organization_id_idx" ON "second_approvals"("organization_id");

-- AddForeignKey
ALTER TABLE "inspection_characteristics" ADD CONSTRAINT "inspection_characteristics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_characteristics" ADD CONSTRAINT "inspection_characteristics_plan_step_id_fkey" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_requirements" ADD CONSTRAINT "photo_requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_requirements" ADD CONSTRAINT "photo_requirements_plan_step_id_fkey" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_production_plan_revision_id_fkey" FOREIGN KEY ("production_plan_revision_id") REFERENCES "production_plan_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_step_instances" ADD CONSTRAINT "work_step_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_step_instances" ADD CONSTRAINT "work_step_instances_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_step_instances" ADD CONSTRAINT "work_step_instances_plan_step_id_fkey" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_step_releases" ADD CONSTRAINT "work_step_releases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_step_releases" ADD CONSTRAINT "work_step_releases_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_submissions" ADD CONSTRAINT "completion_submissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_submissions" ADD CONSTRAINT "completion_submissions_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_confirmations" ADD CONSTRAINT "step_confirmations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_confirmations" ADD CONSTRAINT "step_confirmations_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_checklist_item_id_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_inspection_characteristic_id_fkey" FOREIGN KEY ("inspection_characteristic_id") REFERENCES "inspection_characteristics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_evidence" ADD CONSTRAINT "photo_evidence_photo_requirement_id_fkey" FOREIGN KEY ("photo_requirement_id") REFERENCES "photo_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "second_approvals" ADD CONSTRAINT "second_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "second_approvals" ADD CONSTRAINT "second_approvals_work_step_instance_id_fkey" FOREIGN KEY ("work_step_instance_id") REFERENCES "work_step_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
