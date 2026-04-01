/**
 * Company requirement value types (master: Due date, Bill date, Pay date, etc.)
 */

import { apiRequest } from "@/lib/api";

export type CompanyRequirementDataType = "date" | "int" | "text";

export interface CompanyRequirementValueType {
  id: string;
  name: string;
  data_type: CompanyRequirementDataType;
}

export const companyRequirementValueTypesAPI = {
  getAll: () =>
    apiRequest<CompanyRequirementValueType[]>("/company-requirement-value-types"),
};
