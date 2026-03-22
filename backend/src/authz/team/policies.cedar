// Team (Company) authorization: company_admin and company_director may perform
// company-scoped actions. Role is supplied in context from company_members.

permit (
  principal,
  action,
  resource
)
when {
  context.role == "company_admin" || context.role == "company_director"
};
