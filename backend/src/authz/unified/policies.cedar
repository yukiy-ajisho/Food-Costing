// Unified Cedar: Company + Tenant scope. Role on Principal (not context).

// ----- Company scope: company_admin / company_director only -----
permit (
  principal,
  action,
  resource
)
when {
  resource is Company &&
  principal has company_role &&
  (principal.company_role == "company_admin" || principal.company_role == "company_director")
};

// Team ページ: 親会社の company_admin / company_director が、紐づくテナントのメンバー/招待を管理
permit (
  principal,
  action,
  resource
)
when {
  action == Action::"company::manage_tenant_team" &&
  resource is Tenant &&
  principal has company_role &&
  (principal.company_role == "company_admin" || principal.company_role == "company_director")
};

// ----- Tenant scope: RBAC (admin, director = full; manager with prepped rule; staff = read) -----
// Admin and director: full access (director = admin equivalent at tenant level)
permit (
  principal,
  action,
  resource
)
when {
  (resource is Tenant || resource is CostResource) &&
  principal has tenant_role &&
  principal has tenant_id &&
  (principal.tenant_role == "admin" || principal.tenant_role == "director")
};

// Manager: prepped items require is_owner or is_shared; other resources allowed. Tenant (container) always allowed.
permit (
  principal,
  action,
  resource
)
when {
  principal has tenant_role &&
  principal.tenant_role == "manager" &&
  principal has tenant_id &&
  (
    resource is Tenant ||
    (resource is CostResource && (
      resource.type != "item" ||
      resource.item_kind != "prepped" ||
      context.is_owner == true ||
      context.is_shared == true
    ))
  )
};

