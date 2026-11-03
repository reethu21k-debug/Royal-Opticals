# Data dictionary (generated from the applied migrations — do not edit by hand)

Migrations: 0001_core_schema.sql, 0002_stock_engine.sql, 0003_rls.sql, 0004_review_decision.sql, 0005_counts_matrix_po.sql, 0006_user_admin.sql, 0007_settings_net_archive.sql

## `audit_logs`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| user_id | uuid | YES |  |
| action | text | NO |  |
| entity_type | text | NO |  |
| entity_id | uuid | YES |  |
| before_data | jsonb | YES |  |
| after_data | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |

Constraints: `audit_logs_pkey`: PRIMARY KEY (id)

RLS policies: `audit_read` (SELECT)

## `catalog_nodes`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| parent_id | uuid | YES |  |
| kind | node_kind | NO |  |
| source_name | text | NO |  |
| source_path | text | YES |  |
| sort_order | integer | NO | 0 |
| display_label | text | YES |  |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | now() |

Constraints: `catalog_nodes_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `catalog_nodes_parent_id_fkey`: FOREIGN KEY (parent_id) REFERENCES catalog_nodes(id); `catalog_nodes_pkey`: PRIMARY KEY (id)

Indexes: `catalog_nodes_sibling_uq`; `catalog_nodes_parent_ix`

RLS policies: `catalog_nodes_read` (SELECT), `catalog_write` (ALL)

## `count_lines`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| session_id | uuid | NO |  |
| variant_id | uuid | NO |  |
| recorded_quantity | integer | YES |  |
| recorded_state | quantity_state | NO |  |
| counted_quantity | integer | YES |  |
| counted_by | uuid | YES |  |
| counted_at | timestamp with time zone | YES |  |
| note | text | YES |  |
| result | text | YES |  |

Constraints: `count_lines_counted_quantity_check`: CHECK (((counted_quantity IS NULL) OR (counted_quantity >= 0))); `count_lines_session_id_fkey`: FOREIGN KEY (session_id) REFERENCES count_sessions(id) ON DELETE CASCADE; `count_lines_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `count_lines_pkey`: PRIMARY KEY (id); `count_lines_session_id_variant_id_key`: UNIQUE (session_id, variant_id)

Indexes: `count_lines_session_id_variant_id_key`; `count_lines_session_ix`

RLS policies: `count_lines_read` (SELECT)

## `count_sessions`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| name | text | NO |  |
| scope_node_id | uuid | YES |  |
| status | count_status | NO | 'open'::count_status |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| submitted_at | timestamp with time zone | YES |  |
| approved_by | uuid | YES |  |
| approved_at | timestamp with time zone | YES |  |
| summary | jsonb | YES |  |

Constraints: `count_sessions_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `count_sessions_scope_node_id_fkey`: FOREIGN KEY (scope_node_id) REFERENCES catalog_nodes(id); `count_sessions_pkey`: PRIMARY KEY (id)

RLS policies: `count_sessions_read` (SELECT)

## `import_batches`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| label | text | NO |  |
| source_archive_sha256 | text | YES |  |
| status | import_status | NO | 'staged'::import_status |
| total_source_records | integer | YES |  |
| imported_records | integer | YES |  |
| held_records | integer | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| approved_by | uuid | YES |  |
| approved_at | timestamp with time zone | YES |  |

Constraints: `import_batches_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `import_batches_pkey`: PRIMARY KEY (id)

RLS policies: `import_batches_read` (SELECT)

## `import_records`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| import_batch_id | uuid | NO |  |
| source_file | text | NO |  |
| source_sheet | text | YES |  |
| source_cell | text | YES |  |
| source_file_sha256 | text | YES |  |
| source_payload | jsonb | NO |  |
| status | text | NO | 'staged'::text |
| hold_reason | text | YES |  |
| variant_id | uuid | YES |  |

Constraints: `import_records_import_batch_id_fkey`: FOREIGN KEY (import_batch_id) REFERENCES import_batches(id); `import_records_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `import_records_pkey`: PRIMARY KEY (id)

Indexes: `import_records_batch_ix`

RLS policies: `ir_read` (SELECT)

## `lens_variants`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| block_node_id | uuid | NO |  |
| row_axis_name | text | YES |  |
| col_axis_name | text | YES |  |
| row_label_source | text | YES |  |
| col_label_source | text | YES |  |
| row_key | text | NO |  |
| col_key | text | NO | ''::text |
| row_occurrence | integer | NO | 0 |
| row_value | numeric | YES |  |
| row_value2 | numeric | YES |  |
| col_value | numeric | YES |  |
| attributes | jsonb | NO | '{}'::jsonb |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | now() |
| source_row | integer | YES |  |
| source_col | integer | YES |  |

Constraints: `lens_variants_block_node_id_fkey`: FOREIGN KEY (block_node_id) REFERENCES catalog_nodes(id); `lens_variants_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `lens_variants_pkey`: PRIMARY KEY (id); `lens_variants_block_node_id_row_key_row_occurrence_col_key_key`: UNIQUE (block_node_id, row_key, row_occurrence, col_key)

Indexes: `lens_variants_block_node_id_row_key_row_occurrence_col_key_key`; `lens_variants_block_ix`; `lens_variants_search_ix`; `lens_variants_order_ix`

RLS policies: `lens_variants_read` (SELECT)

## `organizations`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| created_at | timestamp with time zone | NO | now() |

Constraints: `organizations_pkey`: PRIMARY KEY (id)

RLS policies: `org_read` (SELECT)

## `product_suppliers`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| node_id | uuid | YES |  |
| variant_id | uuid | YES |  |
| supplier_id | uuid | NO |  |
| is_preferred | boolean | NO | false |
| supplier_product_code | text | YES |  |

Constraints: `product_suppliers_check`: CHECK (((node_id IS NOT NULL) <> (variant_id IS NOT NULL))); `product_suppliers_node_id_fkey`: FOREIGN KEY (node_id) REFERENCES catalog_nodes(id); `product_suppliers_supplier_id_fkey`: FOREIGN KEY (supplier_id) REFERENCES suppliers(id); `product_suppliers_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `product_suppliers_pkey`: PRIMARY KEY (id)

RLS policies: `product_suppliers_read` (SELECT)

## `profiles`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO |  |
| organization_id | uuid | NO |  |
| full_name | text | NO |  |
| role | app_role | NO | 'read_only'::app_role |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | now() |

Constraints: `profiles_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `profiles_pkey`: PRIMARY KEY (id)

RLS policies: `prof_read` (SELECT)

## `purchase_order_items`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| purchase_order_id | uuid | NO |  |
| variant_id | uuid | NO |  |
| suggested_quantity | integer | YES |  |
| quantity_ordered | integer | NO |  |
| quantity_received | integer | NO | 0 |
| unit_cost | numeric | YES |  |

Constraints: `purchase_order_items_check`: CHECK ((quantity_received <= quantity_ordered)); `purchase_order_items_quantity_ordered_check`: CHECK ((quantity_ordered > 0)); `purchase_order_items_quantity_received_check`: CHECK ((quantity_received >= 0)); `purchase_order_items_purchase_order_id_fkey`: FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id); `purchase_order_items_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `purchase_order_items_pkey`: PRIMARY KEY (id); `purchase_order_items_purchase_order_id_variant_id_key`: UNIQUE (purchase_order_id, variant_id)

Indexes: `purchase_order_items_purchase_order_id_variant_id_key`

RLS policies: `poi_read` (SELECT), `poi_draft_write` (ALL)

## `purchase_orders`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| po_number | text | NO |  |
| supplier_id | uuid | NO |  |
| status | po_status | NO | 'draft'::po_status |
| order_date | date | NO | CURRENT_DATE |
| expected_date | date | YES |  |
| notes | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| closed_reason | text | YES |  |
| closed_at | timestamp with time zone | YES |  |

Constraints: `purchase_orders_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `purchase_orders_supplier_id_fkey`: FOREIGN KEY (supplier_id) REFERENCES suppliers(id); `purchase_orders_pkey`: PRIMARY KEY (id); `purchase_orders_organization_id_po_number_key`: UNIQUE (organization_id, po_number)

Indexes: `purchase_orders_organization_id_po_number_key`

RLS policies: `purchase_orders_read` (SELECT), `po_insert` (INSERT), `po_update_draft` (UPDATE)

## `review_items`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| import_batch_id | uuid | YES |  |
| severity | text | NO |  |
| code | text | NO |  |
| source_file | text | YES |  |
| source_sheet | text | YES |  |
| source_cell | text | YES |  |
| detail | text | NO |  |
| status | review_status | NO | 'open'::review_status |
| decided_by | uuid | YES |  |
| decided_at | timestamp with time zone | YES |  |
| decision_note | text | YES |  |

Constraints: `review_items_import_batch_id_fkey`: FOREIGN KEY (import_batch_id) REFERENCES import_batches(id); `review_items_pkey`: PRIMARY KEY (id)

Indexes: `review_items_status_ix`

RLS policies: `review_items_read` (SELECT), `review_decide` (UPDATE)

## `search_aliases`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| node_id | uuid | YES |  |
| variant_id | uuid | YES |  |
| alias | text | NO |  |

Constraints: `search_aliases_node_id_fkey`: FOREIGN KEY (node_id) REFERENCES catalog_nodes(id) ON DELETE CASCADE; `search_aliases_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `search_aliases_pkey`: PRIMARY KEY (id)

RLS policies: `search_aliases_read` (SELECT)

## `stock_balances`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| variant_id | uuid | NO |  |
| target_quantity | integer | YES |  |
| target_state | quantity_state | NO | 'missing'::quantity_state |
| available_quantity | integer | YES |  |
| available_state | quantity_state | NO | 'missing'::quantity_state |
| version | integer | NO | 0 |
| updated_at | timestamp with time zone | NO | now() |

Constraints: `stock_balances_available_quantity_check`: CHECK (((available_quantity IS NULL) OR (available_quantity >= 0))); `stock_balances_check`: CHECK ((((target_state = 'recorded'::quantity_state) = (target_quantity IS NOT NULL)) OR (target_state = 'unverified'::quantity_state))); `stock_balances_check1`: CHECK ((((available_state = 'recorded'::quantity_state) = (available_quantity IS NOT NULL)) OR (available_state = 'unverified'::quantity_state))); `stock_balances_target_quantity_check`: CHECK (((target_quantity IS NULL) OR (target_quantity >= 0))); `stock_balances_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `stock_balances_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `stock_balances_pkey`: PRIMARY KEY (id); `stock_balances_variant_id_key`: UNIQUE (variant_id)

Indexes: `stock_balances_variant_id_key`

RLS policies: `stock_balances_read` (SELECT)

## `stock_movements`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| variant_id | uuid | NO |  |
| movement_type | movement_type | NO |  |
| quantity_delta | integer | NO |  |
| quantity_before | integer | YES |  |
| quantity_after | integer | NO |  |
| reason | text | YES |  |
| reference_type | text | YES |  |
| reference_id | uuid | YES |  |
| import_batch_id | uuid | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| idempotency_key | uuid | YES |  |

Constraints: `stock_movements_check`: CHECK (((movement_type = 'opening_count'::movement_type) OR (quantity_before IS NOT NULL))); `stock_movements_check1`: CHECK (((quantity_before IS NULL) OR ((quantity_before + quantity_delta) = quantity_after))); `stock_movements_check2`: CHECK (((quantity_before IS NOT NULL) OR (quantity_delta = quantity_after))); `stock_movements_quantity_after_check`: CHECK ((quantity_after >= 0)); `stock_movements_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `stock_movements_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `stock_movements_pkey`: PRIMARY KEY (id)

Indexes: `stock_movements_idem_uq`; `stock_movements_variant_ix`

RLS policies: `stock_movements_read` (SELECT)

## `stock_receipt_items`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| receipt_id | uuid | NO |  |
| variant_id | uuid | NO |  |
| quantity_received | integer | NO |  |
| purchase_order_item_id | uuid | YES |  |
| movement_id | uuid | YES |  |

Constraints: `stock_receipt_items_quantity_received_check`: CHECK ((quantity_received > 0)); `stock_receipt_items_movement_id_fkey`: FOREIGN KEY (movement_id) REFERENCES stock_movements(id); `stock_receipt_items_purchase_order_item_id_fkey`: FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id); `stock_receipt_items_receipt_id_fkey`: FOREIGN KEY (receipt_id) REFERENCES stock_receipts(id); `stock_receipt_items_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `stock_receipt_items_pkey`: PRIMARY KEY (id)

RLS policies: `sri_read` (SELECT)

## `stock_receipts`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| receipt_number | text | NO |  |
| purchase_order_id | uuid | YES |  |
| supplier_id | uuid | YES |  |
| delivery_reference | text | YES |  |
| received_by | uuid | YES |  |
| received_at | timestamp with time zone | NO | now() |
| notes | text | YES |  |
| idempotency_key | uuid | YES |  |

Constraints: `stock_receipts_purchase_order_id_fkey`: FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id); `stock_receipts_supplier_id_fkey`: FOREIGN KEY (supplier_id) REFERENCES suppliers(id); `stock_receipts_pkey`: PRIMARY KEY (id); `stock_receipts_organization_id_receipt_number_key`: UNIQUE (organization_id, receipt_number)

Indexes: `stock_receipts_organization_id_receipt_number_key`; `stock_receipts_idem_uq`

RLS policies: `stock_receipts_read` (SELECT)

## `suppliers`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| supplier_name | text | NO |  |
| supplier_code | text | YES |  |
| contact_person | text | YES |  |
| phone | text | YES |  |
| email | text | YES |  |
| address | text | YES |  |
| notes | text | YES |  |
| is_active | boolean | NO | true |

Constraints: `suppliers_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `suppliers_pkey`: PRIMARY KEY (id); `suppliers_organization_id_supplier_name_key`: UNIQUE (organization_id, supplier_name)

Indexes: `suppliers_organization_id_supplier_name_key`

RLS policies: `suppliers_read` (SELECT), `suppliers_write` (ALL)

## `system_settings`

| Column | Type | Null | Default |
|---|---|---|---|
| organization_id | uuid | NO |  |
| key | text | NO |  |
| value | jsonb | NO |  |
| updated_by | uuid | YES |  |
| updated_at | timestamp with time zone | NO | now() |

Constraints: `system_settings_organization_id_fkey`: FOREIGN KEY (organization_id) REFERENCES organizations(id); `system_settings_pkey`: PRIMARY KEY (organization_id, key)

RLS policies: `system_settings_read` (SELECT)

## `target_changes`

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| organization_id | uuid | NO |  |
| variant_id | uuid | NO |  |
| previous_target | integer | YES |  |
| new_target | integer | YES |  |
| reason | text | YES |  |
| changed_by | uuid | YES |  |
| changed_at | timestamp with time zone | NO | now() |

Constraints: `target_changes_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id); `target_changes_pkey`: PRIMARY KEY (id)

RLS policies: `target_changes_read` (SELECT)

## `variant_source_values`

| Column | Type | Null | Default |
|---|---|---|---|
| variant_id | uuid | NO |  |
| import_record_id | uuid | YES |  |
| target_raw | text | YES |  |
| stock_raw | text | YES |  |
| legacy_order_formula | text | YES |  |
| legacy_order_cached | text | YES |  |
| source_flags | ARRAY | NO | '{}'::text[] |

Constraints: `variant_source_values_variant_id_fkey`: FOREIGN KEY (variant_id) REFERENCES lens_variants(id) ON DELETE CASCADE; `variant_source_values_pkey`: PRIMARY KEY (variant_id)

RLS policies: `vsv_read` (SELECT)

## Enums

- `app_role`: administrator, inventory_manager, inventory_staff, read_only
- `count_status`: open, submitted, approved, cancelled
- `import_status`: staged, validated, approved, imported, failed, rolled_back
- `movement_type`: opening_count, receipt, issue, adjustment, reversal
- `node_kind`: family, folder, workbook, sheet, block
- `po_status`: draft, confirmed, partially_received, received, cancelled, closed_short
- `quantity_state`: recorded, missing, invalid, not_applicable, unverified
- `review_status`: open, approved, rejected, needs_info

## Functions (stock engine / workflows)

- `app_actor()`
- `app_actor_profile()`
- `app_can_manage()`
- `app_org()`
- `app_require_role(VARIADIC roles app_role[])`
- `app_role_of()`
- `app_setting(p_key text)`
- `approve_count_session(p_session uuid)`
- `audit(p_org uuid, p_action text, p_type text, p_id uuid, p_before jsonb, p_after jsonb)`
- `cancel_count_session(p_session uuid)`
- `cancel_purchase_order(p_po uuid, p_reason text)`
- `confirm_purchase_order(p_po uuid)`
- `create_count_session(p_name text, p_node uuid, p_variants uuid[])`
- `decide_review_item(p_id uuid, p_status review_status, p_note text)`
- `forbid_mutation()`
- `node_path(p_node uuid)`
- `post_physical_count(p_variant uuid, p_count integer, p_reason text, p_key uuid)`
- `post_stock_movement(p_variant uuid, p_kind movement_type, p_qty integer, p_reason text, p_ref_type text, p_ref_id uuid, p_key uuid)`
- `receive_purchase_order(p_po uuid, p_items jsonb, p_receipt_number text, p_key uuid)`
- `record_count_line(p_session uuid, p_variant uuid, p_count integer, p_note text)`
- `reopen_count_session(p_session uuid)`
- `set_setting(p_key text, p_value jsonb)`
- `set_target_quantity(p_variant uuid, p_target integer, p_reason text)`
- `set_targets_bulk(p_items jsonb, p_reason text)`
- `set_user_active(p_user uuid, p_active boolean)`
- `set_user_role(p_user uuid, p_role app_role)`
- `set_variant_active(p_variant uuid, p_active boolean)`
- `submit_count_session(p_session uuid)`
- `suggested_order(target integer, available integer)`
- `suggested_order_legacy_blank_as_zero(target integer, available integer)`

## Views

- `v_inventory`