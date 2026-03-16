/**
 * Tenant Requirements v2: tenant_requirement_value_types API
 */

import { apiRequest } from "@/lib/api";

export type TenantRequirementDataType = "date" | "int";

export interface TenantRequirementValueType {
  id: string;
  name: string;
  data_type: TenantRequirementDataType;
}

export const tenantRequirementValueTypesAPI = {
  getAll: () =>
    apiRequest<TenantRequirementValueType[]>("/tenant-requirement-value-types"),
};
