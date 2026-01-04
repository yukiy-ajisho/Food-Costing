// Phase 2: Authorization Policies
// RBAC + ABAC rules using Cedar Policy Language

// Pillar 1: Isolation (already handled by Phase 1a - tenant_id filtering)
// This is enforced at the database query level, not in Cedar policies

// Pillar 2: RBAC - Role-Based Access Control

// Admin: Full access to all actions
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "admin"
};

// Manager: 
// - Prepped Items: 自分が作ったもの OR Adminが許可したもの（authorize.tsで事前チェック済み）
// - その他のリソース: ロール関係なくアクセス可能
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "manager" && (
    // Prepped Itemsの場合: authorize.tsで事前チェック済み（context.is_owner == true または context.is_shared == true）
    // その他のリソース: 常に許可
    resource.resource_type != "item" || 
    resource.item_kind != "prepped" ||
    context.is_owner == true || 
    context.is_shared == true
  )
};

// Staff: Read-only access (no create, update, delete)
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "staff" && action == Action::"read"
};

// Pillar 3: ABAC - Attribute-Based Access Control
// Owner can perform all actions on their resources
permit (
  principal,
  action,
  resource
)
when {
  principal.tenant_id == resource.owner_tenant_id
};

// Pillar 3: ABAC - Sharing (共有機能)
// Shared resources can be accessed by the shared target
// Note: is_shared is set in context by checking resource_shares table
permit (
  principal,
  action,
  resource
)
when {
  context.is_shared == true
};

