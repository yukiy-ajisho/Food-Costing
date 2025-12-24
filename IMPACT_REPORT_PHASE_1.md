# Impact Report: Phase 1 - Multi-Tenant Identity Layer & Virtual Product Decoupling

## Executive Summary

This report documents the complete impact analysis for two major refactoring phases:
1. **Phase 1a**: Multi-Tenant Identity Layer (user_id → tenant_id)
2. **Phase 1b**: Virtual Product Decoupling (vendor_products → virtual_vendor_products + product_mappings)

**Status**: PRE-IMPLEMENTATION ANALYSIS ONLY - NO CODE CHANGES MADE

---

## Phase 1a: Multi-Tenant Identity Layer

### 1. Database Schema Changes Required

#### New Tables to Create

**tenants table:**
```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text CHECK (type IN ('restaurant', 'vendor')),
  created_at timestamptz DEFAULT now()
);
```

**profiles table:**
```sql
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  created_at timestamptz DEFAULT now()
);
```

#### Tables Requiring tenant_id Column Addition

The following tables currently use `user_id` and need `tenant_id` added:
- `base_items`
- `items`
- `recipe_lines`
- `labor_roles`
- `vendors`
- `vendor_products` (will become `virtual_vendor_products` in Phase 1b)
- `proceed_validation_settings`
- `item_unit_profiles`
- `non_mass_units`

**Decision Required**: Should `users` table be deprecated in favor of `profiles`?
- **Recommendation**: Keep `users` table for backward compatibility during migration, but all new queries should use `profiles` → `tenants` relationship.

---

### 2. Express Routes/Controllers Filtering by user_id

#### Complete List of Files with user_id Filters

**Backend Routes (14 files):**

1. **`backend/src/routes/items.ts`** - 12 occurrences
   - GET `/items` - Line 17
   - GET `/items/:id` - Line 50
   - PUT `/items/:id` - Lines 116, 138, 145, 151, 157, 219, 226, 237, 275
   - DELETE `/items/:id` - Line 327

2. **`backend/src/routes/base-items.ts`** - 4 occurrences
   - GET `/base-items` - Line 16
   - GET `/base-items/:id` - Line 40
   - PUT `/base-items/:id` - Line 106
   - DELETE `/base-items/:id` - Line 155

3. **`backend/src/routes/vendor-products.ts`** - 4 occurrences
   - GET `/vendor-products` - Line 16
   - GET `/vendor-products/:id` - Line 40
   - PUT `/vendor-products/:id` - Line 143
   - DELETE `/vendor-products/:id` - Line 206

4. **`backend/src/routes/vendors.ts`** - 4 occurrences
   - GET `/vendors` - Line 16
   - GET `/vendors/:id` - Line 40
   - PUT `/vendors/:id` - Line 106
   - DELETE `/vendors/:id` - Line 135

5. **`backend/src/routes/recipe-lines.ts`** - 18 occurrences
   - Multiple queries throughout for validation, cycle detection, and CRUD operations

6. **`backend/src/routes/recipe-lines-items.ts`** - 2 occurrences
   - GET `/items/:itemId/recipe` - Line 16
   - POST `/items/recipes` - Line 55

7. **`backend/src/routes/labor-roles.ts`** - 4 occurrences
   - All CRUD operations

8. **`backend/src/routes/proceed-validation-settings.ts`** - 3 occurrences
   - GET, PUT operations

9. **`backend/src/routes/item-unit-profiles.ts`** - 2 occurrences
   - GET, POST operations

**Backend Services (3 files):**

10. **`backend/src/services/cost.ts`** - 12 occurrences
    - All data fetching functions: `getBaseItemsMap`, `getItemsMap`, `getVendorProductsMap`, `getLaborRolesMap`
    - Cost calculation functions

11. **`backend/src/services/deprecation.ts`** - 40+ occurrences
    - All deprecation/undeprecation functions
    - Cascade operations

12. **`backend/src/services/cycle-detection.ts`** - 4 occurrences
    - Cycle detection queries

**Total Impact**: **106+ database queries** need to be updated from `user_id` to `tenant_id`.

---

### 3. SQL Functions & Triggers Using user_id

#### PostgreSQL Functions

1. **`calculate_item_costs(p_user_id uuid, p_item_ids uuid[])`**
   - **Location**: `migration_create_calculate_item_costs_function.sql`
   - **Impact**: 
     - Function signature: `p_user_id` → `p_tenant_id`
     - All WHERE clauses filtering by `user_id` (Lines 96, 97, 124, 125, 161, 168, 199, 200, 294)
     - JOIN conditions with `user_id` checks
   - **Critical**: This is the core cost calculation function used by the API

2. **`calculate_item_costs_with_breakdown(p_user_id uuid)`**
   - **Location**: `migration_update_calculate_item_costs_with_breakdown.sql`
   - **Impact**: Similar to above, returns food_cost_per_gram and labor_cost_per_gram separately

#### Database Triggers

1. **`handle_new_user()`**
   - **Location**: `migration_create_user_trigger.sql`
   - **Impact**: Currently creates `users` record. Needs to create `tenants` and `profiles` records instead.

2. **`create_proceed_validation_settings_for_new_auth_user()`**
   - **Location**: Various migration files
   - **Impact**: Needs to use `tenant_id` instead of `user_id`

---

### 4. Middleware Changes Required

**File**: `backend/src/middleware/auth.ts`

**Current Implementation**:
- Validates JWT token
- Extracts `user.id` from Supabase auth
- Sets `req.user = { id: user.id }`

**Required Changes**:
1. After validating user, query `profiles` table to get `tenant_id` and `role`
2. Set `req.user = { id: user.id, tenant_id: tenant_id, role: role }`
3. All subsequent queries should use `req.user.tenant_id` instead of `req.user.id`

**New Middleware Function Needed**:
```typescript
// Pseudo-code
async function tenantMiddleware(req, res, next) {
  const profile = await supabase
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', req.user.id)
    .single();
  
  req.user.tenant_id = profile.tenant_id;
  req.user.role = profile.role;
  next();
}
```

---

### 5. Data Migration Strategy

**Migration Script Requirements**:

1. **Create tenants for existing users**:
   ```sql
   -- For each unique user_id in users table
   INSERT INTO tenants (name, type)
   SELECT 'Restaurant ' || u.id::text, 'restaurant'
   FROM users u;
   ```

2. **Create profiles entries**:
   ```sql
   INSERT INTO profiles (id, tenant_id, role)
   SELECT u.id, t.id, 'admin'
   FROM users u
   JOIN tenants t ON t.name = 'Restaurant ' || u.id::text;
   ```

3. **Update all existing tables**:
   ```sql
   -- For each table (base_items, items, etc.)
   UPDATE table_name t
   SET tenant_id = p.tenant_id
   FROM profiles p
   WHERE t.user_id = p.id;
   ```

**Critical Consideration**: This migration must be atomic and reversible.

---

## Phase 1b: Virtual Product Decoupling

### 1. Database Schema Changes

#### Table Rename
- `vendor_products` → `virtual_vendor_products`

#### Column Removal
- Remove `base_item_id` from `virtual_vendor_products`

#### New Bridge Table
```sql
CREATE TABLE product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_item_id uuid NOT NULL REFERENCES base_items(id) ON DELETE CASCADE,
  virtual_product_id uuid NOT NULL REFERENCES virtual_vendor_products(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (base_item_id, virtual_product_id, tenant_id)
);
```

**Indexes Required**:
- `idx_product_mappings_base_item_id` on `base_item_id`
- `idx_product_mappings_virtual_product_id` on `virtual_product_id`
- `idx_product_mappings_tenant_id` on `tenant_id`

---

### 2. Impact on Joins: base_items ↔ vendor_products

#### Current Join Pattern (Direct)
```sql
-- Current: Direct join
SELECT * FROM vendor_products vp
JOIN base_items bi ON vp.base_item_id = bi.id
WHERE vp.user_id = $1
```

#### New Join Pattern (Through Bridge)
```sql
-- New: Join through product_mappings
SELECT * FROM virtual_vendor_products vvp
JOIN product_mappings pm ON vvp.id = pm.virtual_product_id
JOIN base_items bi ON pm.base_item_id = bi.id
WHERE pm.tenant_id = $1
```

---

### 3. Files Requiring Join Updates

#### Backend Files (6 files):

1. **`backend/src/services/cost.ts`**
   - **Function**: `computeRawCost()` - Line 21-84
     - Currently uses `vendorProduct` directly with `base_item_id`
     - Needs to join through `product_mappings`
   - **Function**: `getCost()` - Lines 195-261
     - Currently filters `vendorProductsMap` by `vp.base_item_id === item.base_item_id`
     - Needs to filter by checking `product_mappings` table
   - **Impact**: Core cost calculation logic - HIGH PRIORITY

2. **`backend/src/routes/vendor-products.ts`**
   - **POST `/vendor-products`** - Line 65
     - Currently requires `base_item_id` in request body
     - Should NOT require `base_item_id` (mapping created separately)
   - **All queries** need to remove `base_item_id` filter

3. **`backend/src/services/deprecation.ts`**
   - **Function**: `deprecateVendorProduct()` - Lines 152-229
     - Currently queries by `vendorProduct.base_item_id`
     - Needs to query `product_mappings` to find affected `base_items`
   - **Function**: `findItemsAffectedByVendorProductChanges()` - Lines 790-836
     - Currently uses `vp.base_item_id`
     - Needs to join through `product_mappings`

4. **`backend/src/routes/recipe-lines.ts`**
   - **Validation**: Lines 42-68
     - Currently validates `specific_child` against `vendor_products` with `base_item_id`
     - Needs to validate through `product_mappings`

5. **`backend/src/services/units.ts`**
   - **Function**: `convertToGrams()` - Lines 48-112
     - Currently uses `baseItemsMap.get(item.base_item_id)`
     - No direct vendor_product join, but may need updates for validation

6. **`backend/src/routes/items.ts`**
   - **Yield validation** - Lines 119-205
     - Currently joins `base_items` directly
     - May need updates if validation involves vendor products

#### PostgreSQL Functions (1 file):

7. **`migration_create_calculate_item_costs_function.sql`**
   - **Lines 73-127**: Raw Item cost calculation
     - **Current**: `WHERE vp.base_item_id = child_items.base_item_id`
     - **New**: Join through `product_mappings`
   - **Lines 93-100**: Lowest cost selection
     - **Current**: Direct join `vp.base_item_id = bi.id`
     - **New**: Join through `product_mappings`
   - **Lines 121-127**: Specific vendor product selection
     - **Current**: `WHERE vp.id = rl.specific_child::uuid`
     - **New**: Must verify mapping exists in `product_mappings`

**Critical**: This function is called by `/items/costs` endpoint and is the primary cost calculation mechanism.

---

### 4. Frontend Files Requiring Updates

#### Files (2 files):

1. **`frontend/app/items/page.tsx`**
   - **Lines 144-180**: Vendor Product UI mapping
     - Currently filters by `vp.base_item_id`
     - Needs to filter by `product_mappings` relationship
   - **Lines 148-149**: Item lookup by `base_item_id`
     - May need to query `product_mappings` instead
   - **Impact**: Items management page - users see vendor products grouped by base item

2. **`frontend/app/cost/page.tsx`**
   - **Function**: `getAvailableVendorProducts()` - Lines 2425-2482
     - **Current**: Filters `vendorProducts` by `vp.base_item_id === childItem.base_item_id`
     - **New**: Must query `product_mappings` to get available products for a base_item
   - **Impact**: Recipe line "Specific Child" dropdown population

3. **`frontend/lib/api.ts`**
   - **Interface**: `VendorProduct` - Line 155
     - Remove `base_item_id: string` field
   - **API Calls**: May need new endpoint for fetching products by base_item via mappings

---

### 5. Cost Resolution Logic Updates

#### Current Logic Flow:
```
Raw Item → base_item_id → vendor_products (filtered by base_item_id) → specific_child selection → cost
```

#### New Logic Flow:
```
Raw Item → base_item_id → product_mappings (filtered by base_item_id) → virtual_vendor_products → specific_child selection → cost
```

#### Specific Changes Required:

**Case: `specific_child = 'lowest'`**
- **Current**: Query all `vendor_products` where `base_item_id = X`, find minimum cost
- **New**: 
  1. Query `product_mappings` where `base_item_id = X` and `tenant_id = Y`
  2. Join to `virtual_vendor_products` on `virtual_product_id`
  3. Find minimum cost from joined results

**Case: `specific_child = UUID`**
- **Current**: Query `vendor_products` where `id = UUID` and `base_item_id = X`
- **New**:
  1. Verify `product_mappings` exists where `virtual_product_id = UUID` and `base_item_id = X` and `tenant_id = Y`
  2. Query `virtual_vendor_products` where `id = UUID`
  3. Return cost

---

### 6. Unique Constraint Refactoring

#### Current Constraint
- **Table**: `vendor_products`
- **Constraint**: Likely on `(base_item_id, vendor_id, product_name, user_id)` or similar
- **Location**: `migration_update_vendor_products_unique_constraint.sql`

#### New Constraint Strategy
- **Option 1**: Constraint on `virtual_vendor_products` level (product uniqueness per tenant)
- **Option 2**: Constraint on `product_mappings` level (mapping uniqueness)
- **Recommendation**: Both
  - `virtual_vendor_products`: Unique on `(vendor_id, product_name, tenant_id)` - prevents duplicate products
  - `product_mappings`: Unique on `(base_item_id, virtual_product_id, tenant_id)` - prevents duplicate mappings

---

### 7. Data Migration for Phase 1b

**Migration Script**:
```sql
-- Step 1: Rename table
ALTER TABLE vendor_products RENAME TO virtual_vendor_products;

-- Step 2: Remove base_item_id column (after data migration)
-- First, migrate data to product_mappings
INSERT INTO product_mappings (base_item_id, virtual_product_id, tenant_id)
SELECT vp.base_item_id, vp.id, vp.tenant_id
FROM virtual_vendor_products vp
WHERE vp.base_item_id IS NOT NULL;

-- Step 3: Remove base_item_id column
ALTER TABLE virtual_vendor_products DROP COLUMN base_item_id;
```

**Critical**: Must ensure all existing `base_item_id` values are migrated before column removal.

---

## Summary of Impact

### Phase 1a: Multi-Tenant Identity Layer
- **Database Tables**: 2 new tables, 9 tables modified
- **Express Routes**: 14 files, 106+ query updates
- **Services**: 3 files, 56+ query updates
- **PostgreSQL Functions**: 2 functions, 10+ query updates
- **Middleware**: 1 file, complete refactor
- **Frontend**: Minimal (API calls remain same, just different filtering)

### Phase 1b: Virtual Product Decoupling
- **Database Tables**: 1 table renamed, 1 table created, 1 column removed
- **Express Routes**: 6 files, 15+ join updates
- **Services**: 3 files, 8+ function updates
- **PostgreSQL Functions**: 1 function, complete rewrite of cost calculation logic
- **Frontend**: 2 files, 3+ function updates

### Total Impact
- **Files to Modify**: ~25 backend files, ~3 frontend files
- **Database Queries to Update**: 180+ queries
- **PostgreSQL Functions**: 2 functions requiring significant changes
- **Migration Scripts**: 2 major migration scripts required

---

## Critical Dependencies & Order of Operations

### Phase 1a Must Complete Before Phase 1b
1. Phase 1a establishes `tenant_id` structure
2. Phase 1b uses `tenant_id` in `product_mappings` table
3. Cannot proceed with Phase 1b until all `tenant_id` columns are in place

### Recommended Implementation Order
1. **Phase 1a - Database Schema**: Create `tenants` and `profiles` tables
2. **Phase 1a - Data Migration**: Migrate existing data
3. **Phase 1a - Backend Refactor**: Update all queries to use `tenant_id`
4. **Phase 1a - Middleware**: Update auth middleware
5. **Phase 1a - Testing**: Verify multi-tenant isolation works
6. **Phase 1b - Database Schema**: Rename table, create `product_mappings`
7. **Phase 1b - Data Migration**: Migrate `base_item_id` relationships
8. **Phase 1b - Backend Refactor**: Update joins and cost calculation
9. **Phase 1b - Frontend Refactor**: Update UI to use mappings
10. **Phase 1b - Testing**: Verify cost calculation and UI work correctly

---

## Risk Assessment

### High Risk Areas
1. **Cost Calculation Logic** (`calculate_item_costs` function)
   - Core business logic
   - Complex joins through new mapping table
   - Must maintain exact same calculation results

2. **Deprecation Logic** (`deprecation.ts`)
   - Cascade operations depend on `base_item_id` relationships
   - Must correctly identify affected items through mappings

3. **Data Migration**
   - Must preserve all existing relationships
   - No data loss during table rename and column removal

### Medium Risk Areas
1. **Frontend UI Updates**
   - User experience changes for product selection
   - Must maintain backward compatibility during migration

2. **Middleware Changes**
   - Authentication flow changes
   - Must handle users without profiles gracefully

### Low Risk Areas
1. **Type Definitions**
   - Straightforward interface updates
   - TypeScript will catch most issues

---

## Testing Requirements

### Phase 1a Testing
- [ ] Verify tenant isolation (users can only see their tenant's data)
- [ ] Verify role-based access (if implemented)
- [ ] Verify existing data migrated correctly
- [ ] Verify all API endpoints work with `tenant_id`

### Phase 1b Testing
- [ ] Verify cost calculations match pre-refactor results
- [ ] Verify "lowest" selection works correctly
- [ ] Verify specific product selection works correctly
- [ ] Verify product mapping UI displays correctly
- [ ] Verify deprecation cascades work through mappings
- [ ] Verify recipe line validation works with mappings

---

## Open Questions

1. **Users Table**: Should `users` table be deprecated or kept for backward compatibility?
2. **Role-Based Access**: Should role-based access control be implemented in Phase 1a or deferred?
3. **Shared Vendor Data**: When will vendor data sharing between tenants be implemented? (Affects Phase 1b design)
4. **Migration Rollback**: What is the rollback strategy if migration fails?
5. **Performance**: Will the additional join through `product_mappings` impact query performance? (Needs benchmarking)

---

**Report Generated**: Pre-Implementation Analysis
**Status**: READY FOR REVIEW - NO CODE CHANGES MADE
**Next Steps**: Review this report, confirm approach, then proceed with implementation

