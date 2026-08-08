# 2. Domänenmodell und Datenbank-ER-Modell

**Dokumentversion:** 1.0  
**Status:** Foundation  
**Gültig ab:** 2026-08-08  

---

## Übersicht

Das Domänenmodell ist relational und normalisiert auf Basis von PostgreSQL 15+. Alle kritischen Tabellen führen:
- `id` (UUID, Primary Key)
- `organization_id` (UUID, Foreign Key – Mandantensicherheit)
- `created_at`, `updated_at` (TIMESTAMP WITH TIME ZONE, UTC)
- `version` (INT, Optimistic Locking)

Audit Trail ist append-only (keine Updates/Deletes für App-Rollen).

---

## ER-Diagramm (High Level)

```
┌─────────────────┐
│  Organization   │
│  ├─ Site        │
│  └─ Department  │
└────────┬────────┘
         │
    ┌────┴─────────┬────────────┬──────────────┐
    │              │            │              │
┌───▼──┐      ┌────▼────┐  ┌───▼────┐   ┌────▼────┐
│Users │      │Projects │  │Products│   │Documents│
├──────┤      ├─────────┤  ├────────┤   ├─────────┤
│Roles │      │Customers│  │Assem.  │   │Revisions│
│Qualif│      │Members  │  │Parts   │   │Approvals│
└──────┘      └────┬────┘  └────┬───┘   └────┬────┘
                   │            │            │
            ┌──────▼────────┐   │            │
            │Prod. Orders   │   │            │
            ├───────────────┤   │    ┌───────▼──────────┐
            │Assignments    │   │    │Prod. Plans       │
            └────┬──────────┘   │    ├──────────────────┤
                 │              │    │Plan Revisions    │
                 │    ┌─────────┴─┬──┤Work Steps        │
                 │    │           │  │Step Dependencies │
            ┌────▼────▼──┐    ┌───▼──▼─────────────────┐
            │Work Step    │    │Requirements           │
            │Instances    │    ├──────────────────────┤
            ├─────────────┤    │Photo Requirements    │
            │Executions   │    │Checklist Templates   │
            │Releases     │    │Inspection Charactcs  │
            └────┬────────┘    └───────────────────────┘
                 │
         ┌───────┴────────┬────────────┬──────────────┐
         │                │            │              │
    ┌────▼────┐      ┌────▼────┐ ┌───▼────┐    ┌────▼────┐
    │Checklists│      │Photos   │ │Measures│    │Comments │
    │Responses │      │Evidence │ │Results │    │Evidence │
    │          │      │         │ │        │    │         │
    └──────────┘      └─────────┘ └────────┘    └─────────┘
         │
    ┌────▼──────────┐
    │2nd Approvals  │
    │Skip Requests  │
    │Completion Sub.│
    └────┬──────────┘
         │
    ┌────▼────────────────┐
    │Non-Conformances     │
    ├─────────────────────┤
    │NCR Evidence         │
    │NCR Dispositions     │
    │Production Holds     │
    │Rework Steps         │
    │Reinspections        │
    └─────────────────────┘
```

---

## Tabellenspezifikation

### 1. Identität und Organisation

#### `organizations`
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `sites`
```sql
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  location TEXT,
  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT sites_org_code_unique UNIQUE (organization_id, code)
);
```

#### `departments`
```sql
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(20),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `work_centers`
```sql
CREATE TABLE work_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  equipment_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  external_id VARCHAR(255) NOT NULL,  -- from OIDC/OAuth2
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  mfa_required BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT users_org_external_unique UNIQUE (organization_id, external_id)
);
```

#### `employees`
```sql
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  employee_number VARCHAR(50) NOT NULL,
  department_id UUID REFERENCES departments(id),
  site_id UUID REFERENCES sites(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT emp_org_number_unique UNIQUE (organization_id, employee_number)
);
```

#### `roles`
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT false,  -- true für Admin, Worker etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT roles_org_code_unique UNIQUE (organization_id, code)
);
```

#### `permissions`
```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  resource VARCHAR(50) NOT NULL,  -- 'document', 'work_step', 'ncr', etc.
  action VARCHAR(50) NOT NULL,     -- 'release', 'execute', 'disposition', etc.
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT perms_org_code_unique UNIQUE (organization_id, code),
  CONSTRAINT perms_resource_action_unique UNIQUE (organization_id, resource, action)
);
```

#### `user_roles`
```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,  -- NULL = no expiry
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT user_roles_org_user_role UNIQUE (organization_id, user_id, role_id)
);
```

#### `role_permissions`
```sql
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT role_perms_org_role_perm UNIQUE (organization_id, role_id, permission_id)
);
```

#### `qualifications`
```sql
CREATE TABLE qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT qual_org_code_unique UNIQUE (organization_id, code)
);
```

#### `employee_qualifications`
```sql
CREATE TABLE employee_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  qualification_id UUID NOT NULL REFERENCES qualifications(id),
  certified_at TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,  -- NULL = no expiry
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `delegations`
```sql
CREATE TABLE delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  delegating_user_id UUID NOT NULL REFERENCES users(id),
  delegated_user_id UUID NOT NULL REFERENCES users(id),
  scope_type VARCHAR(50),  -- 'ROLE', 'PERMISSION', 'QUALIFICATION', etc.
  scope_id UUID,
  reason TEXT,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CHECK (delegating_user_id != delegated_user_id)
);
```

---

### 2. Projekt und Produkt

#### `customers`
```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT cust_org_number_unique UNIQUE (organization_id, customer_number)
);
```

#### `projects`
```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  project_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  customer_order_number VARCHAR(100),
  description TEXT,
  status VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT, ACTIVE, ON_HOLD, COMPLETED, CANCELLED, ARCHIVED
  priority INT DEFAULT 3,  -- 1=highest
  planned_start_date DATE,
  planned_end_date DATE,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT proj_org_number_unique UNIQUE (organization_id, project_number)
);
```

#### `project_members`
```sql
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(50),  -- 'PROJECT_MANAGER', 'QUALITY_MANAGER', 'PROD_LEAD', etc.
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT proj_members_unique UNIQUE (organization_id, project_id, user_id)
);
```

#### `products`
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  product_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT prod_org_number_unique UNIQUE (organization_id, product_number)
);
```

#### `assemblies`
```sql
CREATE TABLE assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  product_id UUID NOT NULL REFERENCES products(id),
  assembly_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_assembly_id UUID REFERENCES assemblies(id),  -- for hierarchies
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `parts`
```sql
CREATE TABLE parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  part_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT part_org_number_unique UNIQUE (organization_id, part_number)
);
```

#### `production_orders`
```sql
CREATE TABLE production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  product_id UUID NOT NULL REFERENCES products(id),
  order_number VARCHAR(50) NOT NULL,
  batch_number VARCHAR(50),
  serial_number VARCHAR(50),
  quantity INT NOT NULL DEFAULT 1,
  status VARCHAR(30) DEFAULT 'DRAFT',  -- DRAFT, PLANNED, RELEASED, IN_PROGRESS, ON_HOLD, QUALITY_BLOCKED, COMPLETED, CANCELLED, ARCHIVED
  planned_start_at TIMESTAMP WITH TIME ZONE,
  planned_end_at TIMESTAMP WITH TIME ZONE,
  actual_start_at TIMESTAMP WITH TIME ZONE,
  actual_end_at TIMESTAMP WITH TIME ZONE,
  production_plan_revision_id UUID NOT NULL,  -- FK ref, see later
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT order_org_number_unique UNIQUE (organization_id, order_number)
);
```

---

### 3. Dokumente und Planung

#### `documents`
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  document_number VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50),  -- 'DRAWING', 'INSTRUCTION', 'SPECIFICATION', 'CHECKLIST', etc.
  department VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT doc_org_number_unique UNIQUE (organization_id, document_number)
);
```

#### `document_revisions`
```sql
CREATE TABLE document_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  document_id UUID NOT NULL REFERENCES documents(id),
  revision_number VARCHAR(20) NOT NULL,  -- '01', '02', etc.
  status VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT, IN_REVIEW, APPROVED, RELEASED, SUPERSEDED, WITHDRAWN, ARCHIVED
  title VARCHAR(255) NOT NULL,
  description TEXT,
  change_reason TEXT,
  mime_type VARCHAR(100),
  file_size_bytes BIGINT,
  file_hash_sha256 VARCHAR(64),  -- hex-encoded
  storage_key VARCHAR(500),  -- s3 key or similar
  malware_scan_status VARCHAR(20),  -- PENDING, CLEAN, INFECTED, ERROR
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  released_by_id UUID REFERENCES users(id),
  released_at TIMESTAMP WITH TIME ZONE,
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE,
  prior_revision_id UUID REFERENCES document_revisions(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT doc_rev_org_doc_rev_unique UNIQUE (organization_id, document_id, revision_number)
);
```

#### `document_approvals`
```sql
CREATE TABLE document_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  document_revision_id UUID NOT NULL REFERENCES document_revisions(id),
  approver_id UUID NOT NULL REFERENCES users(id),
  approval_status VARCHAR(20),  -- 'PENDING', 'APPROVED', 'REJECTED'
  reason TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `production_plans`
```sql
CREATE TABLE production_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  product_id UUID NOT NULL REFERENCES products(id),
  plan_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT plan_org_number_unique UNIQUE (organization_id, plan_number)
);
```

#### `production_plan_revisions`
```sql
CREATE TABLE production_plan_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  production_plan_id UUID NOT NULL REFERENCES production_plans(id),
  revision_number VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'DRAFT',  -- DRAFT, IN_REVIEW, APPROVED, RELEASED, SUPERSEDED, ARCHIVED
  description TEXT,
  change_reason TEXT,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  released_by_id UUID REFERENCES users(id),
  released_at TIMESTAMP WITH TIME ZONE,
  prior_revision_id UUID REFERENCES production_plan_revisions(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT plan_rev_org_plan_rev_unique UNIQUE (organization_id, production_plan_id, revision_number)
);
```

#### `plan_steps`
```sql
CREATE TABLE plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  production_plan_revision_id UUID NOT NULL REFERENCES production_plan_revisions(id),
  step_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  instruction TEXT,
  department_id UUID REFERENCES departments(id),
  work_center_id UUID REFERENCES work_centers(id),
  required_role VARCHAR(50),  -- e.g., 'OPERATOR', 'INSPECTOR'
  estimated_duration_minutes INT,
  photo_required BOOLEAN DEFAULT false,
  signature_required BOOLEAN DEFAULT true,
  four_eyes_required BOOLEAN DEFAULT false,
  four_eyes_scope VARCHAR(50),  -- 'EXECUTION_AND_REVIEW', 'REVIEW_ONLY'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT step_org_plan_number UNIQUE (organization_id, production_plan_revision_id, step_number)
);
```

#### `plan_step_dependencies`
```sql
CREATE TABLE plan_step_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  dependent_step_id UUID NOT NULL REFERENCES plan_steps(id),
  predecessor_step_id UUID NOT NULL REFERENCES plan_steps(id),
  dependency_type VARCHAR(20) DEFAULT 'FINISH_TO_START',  -- FSS, SSS, FFS, etc.
  lag_minutes INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT step_dep_unique UNIQUE (organization_id, dependent_step_id, predecessor_step_id)
);
```

---

### 4. Ausführung

#### `work_step_instances`
```sql
CREATE TABLE work_step_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  production_order_id UUID NOT NULL REFERENCES production_orders(id),
  plan_step_id UUID NOT NULL REFERENCES plan_steps(id),
  status VARCHAR(30) DEFAULT 'LOCKED',  -- LOCKED, READY, IN_PROGRESS, PAUSED, COMPLETED_PENDING_SYNC, WAITING_FOR_SERVER, VALIDATING, AWAITING_SECOND_APPROVAL, COMPLETED, COMPLETION_REJECTED, BLOCKED, SKIP_REQUEST_PENDING_SYNC, SKIP_REQUESTED, SKIPPED, REWORK_REQUIRED, SUPERSEDED
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `work_step_releases`
```sql
CREATE TABLE work_step_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL UNIQUE REFERENCES work_step_instances(id),
  released_by_id UUID NOT NULL REFERENCES users(id),
  released_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  token_hash VARCHAR(128),  -- SHA-256 hash of actual token sent to client
  token_nonce VARCHAR(64),  -- server nonce for client-side validation
  valid_until TIMESTAMP WITH TIME ZONE,
  plan_revision_hash VARCHAR(64),  -- snapshot of plan state
  document_set_hash VARCHAR(64),   -- snapshot of required documents
  is_valid BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `completion_submissions`
```sql
CREATE TABLE completion_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  submitted_by_id UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(30) DEFAULT 'PENDING_VALIDATION',  -- PENDING_VALIDATION, VALIDATED, REJECTED
  validation_status VARCHAR(20),  -- OK, MISSING_EVIDENCE, OUT_OF_TOLERANCE, PERMISSION_REVOKED, etc.
  validation_reason TEXT,
  validated_at TIMESTAMP WITH TIME ZONE,
  validated_by_id UUID REFERENCES users(id),
  used_plan_revision_id UUID NOT NULL REFERENCES production_plan_revisions(id),
  used_document_revision_ids TEXT,  -- JSON array of UUIDs
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT compl_sub_org_step UNIQUE (organization_id, work_step_instance_id)
);
```

#### `step_confirmations`
```sql
CREATE TABLE step_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  confirmed_by_id UUID NOT NULL REFERENCES users(id),
  confirmation_text TEXT NOT NULL,  -- standardized or custom
  signature_method VARCHAR(50),  -- PIN, DIGITAL_SIGNATURE, BIOMETRIC, etc.
  signature_data TEXT,
  device_id VARCHAR(255),
  confirmed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `checklist_responses`
```sql
CREATE TABLE checklist_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  checklist_template_id UUID NOT NULL,
  checklist_item_id UUID NOT NULL,
  response VARCHAR(20),  -- 'OK', 'NOK', 'N/A'
  comment TEXT,
  responded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `measurement_results`
```sql
CREATE TABLE measurement_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  inspection_characteristic_id UUID NOT NULL,
  measured_value NUMERIC(20, 6) NOT NULL,
  measured_unit VARCHAR(20),
  lower_limit NUMERIC(20, 6),
  upper_limit NUMERIC(20, 6),
  measured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  measuring_equipment_id UUID REFERENCES measuring_equipment(id),
  measuring_equipment_serial VARCHAR(100),
  is_within_tolerance BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN measured_value >= COALESCE(lower_limit, measured_value) AND
              measured_value <= COALESCE(upper_limit, measured_value)
         THEN true ELSE false END
  ) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `photo_evidence`
```sql
CREATE TABLE photo_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  file_hash_sha256 VARCHAR(64) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  storage_key VARCHAR(500),  -- s3 key
  photo_category VARCHAR(50),  -- 'OVERVIEW', 'DETAIL', 'TYPESIGN', custom
  description TEXT,
  taken_at TIMESTAMP WITH TIME ZONE NOT NULL,
  device_id VARCHAR(255),
  upload_status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, COMPLETED, FAILED
  uploaded_at TIMESTAMP WITH TIME ZONE,
  is_required_photo BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `second_approvals`
```sql
CREATE TABLE second_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  executor_id UUID NOT NULL REFERENCES users(id),
  reviewer_id UUID REFERENCES users(id),
  reviewer_status VARCHAR(20),  -- 'PENDING', 'APPROVED', 'REJECTED'
  reviewer_reason TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CHECK (executor_id != reviewer_id),
  CONSTRAINT second_appr_org_step UNIQUE (organization_id, work_step_instance_id)
);
```

#### `skip_requests`
```sql
CREATE TABLE skip_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  work_step_instance_id UUID NOT NULL REFERENCES work_step_instances(id),
  requested_by_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, APPROVED, REJECTED
  decided_by_id UUID REFERENCES users(id),
  decision_reason TEXT,
  decided_at TIMESTAMP WITH TIME ZONE,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

---

### 5. Qualität

#### `non_conformances`
```sql
CREATE TABLE non_conformances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  ncr_number VARCHAR(50) NOT NULL,
  production_order_id UUID NOT NULL REFERENCES production_orders(id),
  work_step_instance_id UUID REFERENCES work_step_instances(id),
  product_id UUID NOT NULL REFERENCES products(id),
  batch_number VARCHAR(50),
  serial_number VARCHAR(50),
  description TEXT NOT NULL,
  error_category VARCHAR(50),
  discovered_at TIMESTAMP WITH TIME ZONE NOT NULL,
  discovered_by_id UUID NOT NULL REFERENCES users(id),
  priority VARCHAR(20),  -- CRITICAL, HIGH, MEDIUM, LOW
  status VARCHAR(30) DEFAULT 'OPEN',  -- DRAFT, OPEN, ASSESSMENT_REQUIRED, CONTAINMENT, REWORK, REINSPECTION, AWAITING_DISPOSITION, CLOSED, CANCELLED
  is_blocking BOOLEAN DEFAULT false,
  assigned_to_id UUID REFERENCES users(id),
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT ncr_org_number_unique UNIQUE (organization_id, ncr_number)
);
```

#### `production_holds`
```sql
CREATE TABLE production_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  production_order_id UUID REFERENCES production_orders(id),
  work_step_instance_id UUID REFERENCES work_step_instances(id),
  hold_reason VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  issued_by_id UUID NOT NULL REFERENCES users(id),
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  released_by_id UUID REFERENCES users(id),
  released_at TIMESTAMP WITH TIME ZONE,
  release_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

#### `measuring_equipment`
```sql
CREATE TABLE measuring_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  equipment_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  manufacturer VARCHAR(255),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  measurement_range_min NUMERIC(20, 6),
  measurement_range_max NUMERIC(20, 6),
  measurement_unit VARCHAR(20),
  status VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE, MAINTENANCE, OUT_OF_SERVICE, RETIRED
  location VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT equip_org_number_unique UNIQUE (organization_id, equipment_number)
);
```

#### `calibrations`
```sql
CREATE TABLE calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  measuring_equipment_id UUID NOT NULL REFERENCES measuring_equipment(id),
  calibrated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  next_calibration_due_at TIMESTAMP WITH TIME ZONE NOT NULL,
  calibrated_by VARCHAR(255),
  calibration_certificate_key VARCHAR(500),  -- s3 storage key
  status VARCHAR(20) DEFAULT 'VALID',  -- VALID, EXPIRED, FAILED
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1
);
```

---

### 6. Betrieb und Audit

#### `audit_events` (APPEND ONLY)
```sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  event_id VARCHAR(50) NOT NULL,  -- globally unique
  correlation_id VARCHAR(50),
  actor_id UUID REFERENCES users(id),
  delegated_actor_id UUID REFERENCES users(id),  -- if acting on behalf
  event_type VARCHAR(100) NOT NULL,  -- 'work_step.started', 'document.released', etc.
  resource_type VARCHAR(50) NOT NULL,  -- 'work_step', 'document', 'ncr', etc.
  resource_id UUID,
  previous_values TEXT,  -- JSON
  new_values TEXT,  -- JSON
  reason TEXT,
  source VARCHAR(50),  -- 'web', 'mobile', 'api', 'import', etc.
  device_id VARCHAR(255),
  client_timestamp TIMESTAMP WITH TIME ZONE,  -- client-submitted time
  server_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  result VARCHAR(20),  -- 'SUCCESS', 'FAILURE', 'PARTIAL'
  failure_reason TEXT,
  request_id VARCHAR(100),
  idempotency_key VARCHAR(255),
  version INT DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- NO UPDATE/DELETE allowed for app roles
  CONSTRAINT audit_append_only CHECK (created_at = now())
);

-- Prevent app-role updates
CREATE POLICY audit_no_update ON audit_events FOR UPDATE USING (false);
CREATE POLICY audit_no_delete ON audit_events FOR DELETE USING (false);
```

#### `outbox_events`
```sql
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  aggregate_type VARCHAR(50) NOT NULL,  -- 'production_order', 'work_step', etc.
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE,
  processed BOOLEAN DEFAULT false,
  retry_count INT DEFAULT 0
);
```

#### `sync_cursors`
```sql
CREATE TABLE sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  device_id VARCHAR(255) NOT NULL,
  last_cursor BIGINT DEFAULT 0,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  version INT DEFAULT 1,
  CONSTRAINT sync_cursor_org_user_device UNIQUE (organization_id, user_id, device_id)
);
```

---

## Enums & Reference Values

### Production Order Status
```
DRAFT → PLANNED → RELEASED → IN_PROGRESS → COMPLETED
                     ↓
                  ON_HOLD
                     ↓
              QUALITY_BLOCKED → (resolve) → IN_PROGRESS
                                 
→ CANCELLED, ARCHIVED (at end)
```

### Work Step Instance Status
```
LOCKED → READY → IN_PROGRESS → COMPLETED_PENDING_SYNC
                      ↓                    ↓
                    PAUSED         WAITING_FOR_SERVER
                      ↓                    ↓
              IN_PROGRESS         VALIDATING
                                        ↓
                          COMPLETED or COMPLETION_REJECTED
                                        
← BLOCKED (from NCR, Hold)
← SKIPPED (via approval)
← REWORK_REQUIRED (from NCR)
← SUPERSEDED (plan change)
```

---

## Integritätsregeln & Constraints

| Regel | Implementierung |
|-------|-----------------|
| Org-ID auf kritischen Tabellen | FK + NOT NULL + Query WHERE org_id |
| Dokumentrevision nach Freigabe unveränderlich | Status = RELEASED → Version frozen, keine UPDATEs außer Status |
| Audit-only append | CHECK + POLICY: no UPDATE/DELETE |
| Vier-Augen bei Prüfungen | DB CHECK: executor_id ≠ reviewer_id |
| Arbeitsschritt release token eindeutig | UNIQUE (work_step_instance_id) |
| Offline-Status bei lokal fertiggestellt | Client schreibt COMPLETED_PENDING_SYNC, nicht COMPLETED |
| Gültige Kalibrierung vor Messung | Server prüft: calibration.next_due > measurement.timestamp |
| Seriennummer eindeutig je Projekt | UNIQUE (organization_id, project_id, serial_number) |
| Abhängigkeitszyklus unmöglich | DB-Constraint oder Applikation prüft vor Freigabe |

---

## Migrationen und Versionierung

Alle Tabellen unterstützen `version` (Optimistic Locking) für Offline-Konflikt-Handling:
- Client sendet `version=5`
- Server prüft aktuell Version
- Bei Mismatch: `CONFLICT` zurückgeben, nicht blind Überschreiben

**Schema-Versionierung:**
- `schema_versions` Tabelle mit Datum, Name, Beschreibung
- Migrationen sind timestamped und idempotent
- Kein Rollback von veröffentlichten Historien (nur forward)

---

## Nächste Schritte

→ **03_STATE_MACHINES.md**: Detaillierte State Machine Diagramme und Guard Conditions
