-- Royal Opticals — core schema (PostgreSQL 15+ / Supabase)
-- Design drivers (all from the source audit, see docs/source-data-audit.md):
--   * Source hierarchy has variable depth (3–7 folder levels + workbook + sheet + block) -> adjacency-list tree.
--   * Exact source labels are stored verbatim (`source_name`, `*_source`); display labels/aliases are separate.
--   * ~48% of source stock cells are BLANK; blank != 0 -> quantities are NULLable with an explicit state.
--   * Legacy ORDER LENS values (formula text + cached value) are preserved but never used as stock.
--   * Anomalies need an approval workflow -> review_items.


create type app_role as enum ('administrator','inventory_manager','inventory_staff','read_only');
create type node_kind as enum ('family','folder','workbook','sheet','block');
create type quantity_state as enum ('recorded','missing','invalid','not_applicable','unverified');
create type movement_type as enum ('opening_count','receipt','issue','adjustment','reversal');
create type po_status as enum ('draft','confirmed','partially_received','received','cancelled','closed_short');
create type review_status as enum ('open','approved','rejected','needs_info');
create type import_status as enum ('staged','validated','approved','imported','failed','rolled_back');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key,                         -- = auth.users.id
  organization_id uuid not null references organizations(id),
  full_name text not null,
  role app_role not null default 'read_only',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table system_settings (
  organization_id uuid not null references organizations(id),
  key text not null,
  value jsonb not null,
  updated_by uuid, updated_at timestamptz not null default now(),
  primary key (organization_id, key)
);

-- ───────────── catalog: exact source hierarchy ─────────────
create table catalog_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  parent_id uuid references catalog_nodes(id),
  kind node_kind not null,
  source_name text not null,                   -- EXACT original label (case, spaces, typos preserved)
  source_path text,                            -- original relative path (folders/workbooks)
  sort_order integer not null default 0,
  display_label text,                          -- optional, never replaces source_name
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index catalog_nodes_sibling_uq
  on catalog_nodes (organization_id, coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid), kind, source_name);
create index catalog_nodes_parent_ix on catalog_nodes(parent_id);

create table search_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  node_id uuid references catalog_nodes(id) on delete cascade,
  variant_id uuid,
  alias text not null
);

-- A "variant" = one stockable grid position. Identity = block + row label (+ occurrence) + column label.
create table lens_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  block_node_id uuid not null references catalog_nodes(id),
  row_axis_name text, col_axis_name text,       -- e.g. '(+) SPH', 'ADD'  (verbatim)
  row_label_source text, col_label_source text, -- verbatim, e.g. ' +0.25+0.50'
  row_key text not null, col_key text not null default '', row_occurrence integer not null default 0,
  row_value numeric, row_value2 numeric, col_value numeric,   -- parsed numerics; NULL = not parseable (never 0 by default)
  attributes jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (block_node_id, row_key, row_occurrence, col_key)
);
create index lens_variants_block_ix on lens_variants(block_node_id);
create index lens_variants_search_ix on lens_variants using gin (to_tsvector('simple', coalesce(row_label_source,'')||' '||coalesce(col_label_source,'')));

-- Legacy values kept for audit/comparison only.
create table variant_source_values (
  variant_id uuid primary key references lens_variants(id) on delete cascade,
  import_record_id uuid,
  target_raw text, stock_raw text,
  legacy_order_formula text, legacy_order_cached text,
  source_flags text[] not null default '{}'
);

-- ───────────── stock ─────────────
create table stock_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  variant_id uuid not null references lens_variants(id),
  target_quantity integer check (target_quantity is null or target_quantity >= 0),
  target_state quantity_state not null default 'missing',
  available_quantity integer check (available_quantity is null or available_quantity >= 0),
  available_state quantity_state not null default 'missing',
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (variant_id),
  check ((target_state = 'recorded') = (target_quantity is not null) or target_state in ('unverified')),
  check ((available_state = 'recorded') = (available_quantity is not null) or available_state in ('unverified'))
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  variant_id uuid not null references lens_variants(id),
  movement_type movement_type not null,
  quantity_delta integer not null,
  quantity_before integer,                      -- NULL only for opening_count (balance was unknown)
  quantity_after integer not null check (quantity_after >= 0),
  reason text,
  reference_type text, reference_id uuid,
  import_batch_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  idempotency_key uuid,
  check (movement_type = 'opening_count' or quantity_before is not null),
  check (quantity_before is null or quantity_before + quantity_delta = quantity_after),
  check (quantity_before is not null or quantity_delta = quantity_after)
);
create unique index stock_movements_idem_uq on stock_movements(organization_id, idempotency_key) where idempotency_key is not null;
create index stock_movements_variant_ix on stock_movements(variant_id, created_at desc);

create table target_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, variant_id uuid not null references lens_variants(id),
  previous_target integer, new_target integer, reason text,
  changed_by uuid, changed_at timestamptz not null default now()
);

-- ───────────── purchasing ─────────────
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  supplier_name text not null, supplier_code text, contact_person text, phone text, email text, address text, notes text,
  is_active boolean not null default true,
  unique (organization_id, supplier_name)
);
create table product_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, node_id uuid references catalog_nodes(id), variant_id uuid references lens_variants(id),
  supplier_id uuid not null references suppliers(id), is_preferred boolean not null default false, supplier_product_code text,
  check ((node_id is not null) <> (variant_id is not null))
);
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  po_number text not null, supplier_id uuid not null references suppliers(id),
  status po_status not null default 'draft',
  order_date date not null default current_date, expected_date date, notes text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (organization_id, po_number)
);
create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  variant_id uuid not null references lens_variants(id),
  suggested_quantity integer,                   -- snapshot of the suggestion; distinct from what was ordered
  quantity_ordered integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  unit_cost numeric(12,2),
  check (quantity_received <= quantity_ordered),
  unique (purchase_order_id, variant_id)
);
create table stock_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, receipt_number text not null,
  purchase_order_id uuid references purchase_orders(id), supplier_id uuid references suppliers(id),
  delivery_reference text, received_by uuid, received_at timestamptz not null default now(), notes text,
  idempotency_key uuid,
  unique (organization_id, receipt_number)
);
create unique index stock_receipts_idem_uq on stock_receipts(organization_id, idempotency_key) where idempotency_key is not null;
create table stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references stock_receipts(id),
  variant_id uuid not null references lens_variants(id),
  quantity_received integer not null check (quantity_received > 0),
  purchase_order_item_id uuid references purchase_order_items(id),
  movement_id uuid references stock_movements(id)
);

-- ───────────── migration / review ─────────────
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  label text not null, source_archive_sha256 text, status import_status not null default 'staged',
  total_source_records integer, imported_records integer, held_records integer,
  created_by uuid, created_at timestamptz not null default now(), approved_by uuid, approved_at timestamptz
);
create table import_records (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id),
  source_file text not null, source_sheet text, source_cell text,   -- traceability back to original
  source_file_sha256 text,
  source_payload jsonb not null,                -- original extracted record
  status text not null default 'staged',        -- staged | imported | held_duplicate | held_review
  hold_reason text,
  variant_id uuid references lens_variants(id)
);
create index import_records_batch_ix on import_records(import_batch_id, status);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, import_batch_id uuid references import_batches(id),
  severity text not null, code text not null, source_file text, source_sheet text, source_cell text, detail text not null,
  status review_status not null default 'open',
  decided_by uuid, decided_at timestamptz, decision_note text
);
create index review_items_status_ix on review_items(status, severity);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, user_id uuid, action text not null,
  entity_type text not null, entity_id uuid, before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now()
);
