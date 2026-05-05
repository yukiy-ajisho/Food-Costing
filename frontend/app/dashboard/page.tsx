"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import { Inbox, ShieldAlert, Sigma } from "lucide-react";
import { documentInboxAPI } from "@/lib/api/document-inbox";
import { userRequirementsAPI } from "@/lib/api/reminder/user-requirements";
import { mappingUserRequirementsAPI } from "@/lib/api/reminder/mapping-user-requirements";
import { userRequirementAssignmentsAPI } from "@/lib/api/reminder/user-requirement-assignments";
import { tenantRequirementsAPI } from "@/lib/api/reminder/tenant-requirements";
import { tenantRequirementValueTypesAPI } from "@/lib/api/reminder/tenant-requirement-value-types";
import { tenantRequirementRealDataAPI } from "@/lib/api/reminder/tenant-requirement-real-data";
import { companyRequirementsAPI } from "@/lib/api/reminder/company-requirements";
import { companyRequirementValueTypesAPI } from "@/lib/api/reminder/company-requirement-value-types";
import { companyRequirementRealDataAPI } from "@/lib/api/reminder/company-requirement-real-data";
import { apiRequest } from "@/lib/api";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateYmd: string, months: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function addYears(dateYmd: string, years: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  const origMonth = d.getMonth();
  d.setFullYear(d.getFullYear() + years);
  if (d.getMonth() !== origMonth) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { selectedCompanyId } = useCompany();
  const { selectedTenantId } = useTenant();
  const [uploadedDocumentCount, setUploadedDocumentCount] = useState(0);
  const [licenseOverdueTotal, setLicenseOverdueTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const docsPromise = documentInboxAPI
          .forDocumentBox()
          .then((rows) => rows.length)
          .catch(() => 0);

        const employeeOverduePromise = (async () => {
          if (!selectedCompanyId) return 0;
          const requirements =
            await userRequirementsAPI.getAll(selectedCompanyId);
          if (requirements.length === 0) return 0;
          const [{ members }, rows, { assignments }] = await Promise.all([
            apiRequest<{
              members: { user_id: string; hire_date?: string | null }[];
            }>(
              `/reminder-members?company_id=${encodeURIComponent(selectedCompanyId)}`,
            ),
            mappingUserRequirementsAPI.getMappings({
              user_requirement_ids: requirements.map((r) => r.id),
            }),
            userRequirementAssignmentsAPI.getAssignments({
              user_requirement_ids: requirements.map((r) => r.id),
            }),
          ]);
          const people = members ?? [];
          if (people.length === 0) return 0;
          const userIdSet = new Set(people.map((m) => m.user_id));
          const hireDateByUser = new Map(
            people.map((m) => [m.user_id, m.hire_date ?? null]),
          );
          const mappingByUserReq = new Map<
            string,
            { issuedDate: string | null; deadline: string | null }
          >();
          for (const row of rows) {
            if (!userIdSet.has(row.user_id)) continue;
            mappingByUserReq.set(`${row.user_id}:${row.user_requirement_id}`, {
              issuedDate: row.issued_date ?? null,
              deadline: row.specific_date ?? null,
            });
          }
          const assignedByUserReq = new Set<string>();
          for (const a of assignments ?? []) {
            if (!userIdSet.has(a.user_id)) continue;
            if (a.is_currently_assigned) {
              assignedByUserReq.add(`${a.user_id}:${a.user_requirement_id}`);
            }
          }
          const today = todayYmd();
          let overdue = 0;
          for (const person of people) {
            for (const req of requirements) {
              const key = `${person.user_id}:${req.id}`;
              if (!assignedByUserReq.has(key)) continue;
              const entry = mappingByUserReq.get(key) ?? {
                issuedDate: null,
                deadline: null,
              };
              let expiration: string | null = null;
              if (!req.auto) {
                expiration = entry.deadline;
                if (!expiration) {
                  if (req.firstDueOnDate) expiration = req.firstDueOnDate;
                  else if ((req.firstDueDate ?? 0) > 0) {
                    const hireDate = hireDateByUser.get(person.user_id);
                    if (hireDate)
                      expiration = addDays(hireDate, req.firstDueDate!);
                  }
                }
              } else if (entry.issuedDate && (req.validityPeriod ?? 0) > 0) {
                const unit = req.validityPeriodUnit ?? "years";
                expiration =
                  unit === "months"
                    ? addMonths(entry.issuedDate, req.validityPeriod!)
                    : unit === "days"
                      ? addDays(entry.issuedDate, req.validityPeriod!)
                      : addYears(entry.issuedDate, req.validityPeriod!);
              } else if (req.firstDueOnDate) expiration = req.firstDueOnDate;
              else if ((req.firstDueDate ?? 0) > 0) {
                const hireDate = hireDateByUser.get(person.user_id);
                if (hireDate) expiration = addDays(hireDate, req.firstDueDate!);
              }
              if (expiration && expiration <= today) overdue += 1;
            }
          }
          return overdue;
        })().catch(() => 0);

        const tenantOverduePromise = (async () => {
          if (!selectedTenantId) return 0;
          const [requirements, valueTypes] = await Promise.all([
            tenantRequirementsAPI.getAll(selectedTenantId),
            tenantRequirementValueTypesAPI.getAll(),
          ]);
          if (requirements.length === 0) return 0;
          const rows = await tenantRequirementRealDataAPI.getByRequirementIds(
            requirements.map((r) => r.id),
          );
          const nameById = new Map(valueTypes.map((vt) => [vt.id, vt.name]));
          const maxGroupByReq = new Map<string, number>();
          for (const row of rows) {
            const prev = maxGroupByReq.get(row.tenant_requirement_id);
            if (prev == null || row.group_key > prev) {
              maxGroupByReq.set(row.tenant_requirement_id, row.group_key);
            }
          }
          let overdue = 0;
          const today = todayYmd();
          for (const req of requirements) {
            let dueDate: string | null = null;
            let estimatedDueDate: string | null = null;
            let validityValue: string | null = null;
            let validityUnit: "years" | "months" | "days" | null = null;
            for (const row of rows) {
              if (row.tenant_requirement_id !== req.id) continue;
              if (maxGroupByReq.get(req.id) !== row.group_key) continue;
              const name = nameById.get(row.type_id);
              if (name === "Due date") dueDate = row.value ?? null;
              else if (name === "Estimated specific due date") {
                estimatedDueDate = row.value ?? null;
              } else if (
                name === "Estimated due date based on validity duration" &&
                estimatedDueDate == null
              ) {
                estimatedDueDate = row.value ?? null;
              } else if (name === "Validity duration (years)") {
                validityValue = row.value ?? null;
                validityUnit = "years";
              } else if (name === "Validity duration (months)") {
                validityValue = row.value ?? null;
                validityUnit = "months";
              } else if (name === "Validity duration (days)") {
                validityValue = row.value ?? null;
                validityUnit = "days";
              }
            }
            let expiration = estimatedDueDate;
            if (!expiration && dueDate && validityValue && validityUnit) {
              const n = parseInt(validityValue, 10);
              if (Number.isInteger(n) && n > 0) {
                expiration =
                  validityUnit === "years"
                    ? addYears(dueDate, n)
                    : validityUnit === "months"
                      ? addMonths(dueDate, n)
                      : addDays(dueDate, n);
              }
            }
            if (expiration && expiration <= today) overdue += 1;
          }
          return overdue;
        })().catch(() => 0);

        const companyOverduePromise = (async () => {
          if (!selectedCompanyId) return 0;
          const [requirements, valueTypes] = await Promise.all([
            companyRequirementsAPI.getAll(selectedCompanyId),
            companyRequirementValueTypesAPI.getAll(),
          ]);
          if (requirements.length === 0) return 0;
          const rows = await companyRequirementRealDataAPI.getByRequirementIds(
            requirements.map((r) => r.id),
          );
          const nameById = new Map(valueTypes.map((vt) => [vt.id, vt.name]));
          const maxGroupByReq = new Map<string, number>();
          for (const row of rows) {
            const prev = maxGroupByReq.get(row.company_requirement_id);
            if (prev == null || row.group_key > prev) {
              maxGroupByReq.set(row.company_requirement_id, row.group_key);
            }
          }
          let overdue = 0;
          const today = todayYmd();
          for (const req of requirements) {
            let dueDate: string | null = null;
            let estimatedDueDate: string | null = null;
            let validityValue: string | null = null;
            let validityUnit: "years" | "months" | "days" | null = null;
            for (const row of rows) {
              if (row.company_requirement_id !== req.id) continue;
              if (maxGroupByReq.get(req.id) !== row.group_key) continue;
              const name = nameById.get(row.type_id);
              if (name === "Due date") dueDate = row.value ?? null;
              else if (name === "Estimated specific due date") {
                estimatedDueDate = row.value ?? null;
              } else if (
                name === "Estimated due date based on validity duration" &&
                estimatedDueDate == null
              ) {
                estimatedDueDate = row.value ?? null;
              } else if (name === "Validity duration (years)") {
                validityValue = row.value ?? null;
                validityUnit = "years";
              } else if (name === "Validity duration (months)") {
                validityValue = row.value ?? null;
                validityUnit = "months";
              } else if (name === "Validity duration (days)") {
                validityValue = row.value ?? null;
                validityUnit = "days";
              }
            }
            let expiration = estimatedDueDate;
            if (!expiration && dueDate && validityValue && validityUnit) {
              const n = parseInt(validityValue, 10);
              if (Number.isInteger(n) && n > 0) {
                expiration =
                  validityUnit === "years"
                    ? addYears(dueDate, n)
                    : validityUnit === "months"
                      ? addMonths(dueDate, n)
                      : addDays(dueDate, n);
              }
            }
            if (expiration && expiration <= today) overdue += 1;
          }
          return overdue;
        })().catch(() => 0);

        const [docs, employee, tenant, company] = await Promise.all([
          docsPromise,
          employeeOverduePromise,
          tenantOverduePromise,
          companyOverduePromise,
        ]);

        if (cancelled) return;
        setUploadedDocumentCount(docs);
        setLicenseOverdueTotal(employee + tenant + company);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, selectedTenantId]);

  const total = useMemo(
    () => uploadedDocumentCount + licenseOverdueTotal,
    [uploadedDocumentCount, licenseOverdueTotal],
  );

  return (
    <div className="px-8 pt-8 pb-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1
            className={`text-2xl font-semibold ${
              isDark ? "text-slate-100" : "text-gray-900"
            }`}
          >
            Dashboard
          </h1>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div
            className={`rounded-2xl border p-5 shadow-sm transition-colors ${
              isDark
                ? "border-slate-600 bg-gradient-to-br from-slate-800 to-slate-900"
                : "border-gray-200 bg-gradient-to-br from-white to-blue-50/60"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  Uploaded Document
                </p>
                <p
                  className={`mt-2 ml-5 text-3xl font-bold [font-variant-numeric:tabular-nums] ${
                    isDark ? "text-slate-100" : "text-gray-900"
                  }`}
                >
                  {loading ? (
                    <span
                      className={`inline-block h-7 w-7 animate-spin rounded-full border-2 ${
                        isDark
                          ? "border-slate-500 border-t-slate-200"
                          : "border-gray-300 border-t-gray-600"
                      }`}
                    />
                  ) : (
                    uploadedDocumentCount
                  )}
                </p>
              </div>
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                  isDark
                    ? "bg-blue-900/40 text-blue-300"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                <Inbox className="h-5 w-5" />
              </span>
            </div>
          </div>
          <div
            className={`rounded-2xl border p-5 shadow-sm transition-colors ${
              isDark
                ? "border-slate-600 bg-gradient-to-br from-slate-800 to-slate-900"
                : "border-gray-200 bg-gradient-to-br from-white to-amber-50/70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  License Overdue
                </p>
                <p
                  className={`mt-2 ml-5 text-3xl font-bold [font-variant-numeric:tabular-nums] ${
                    isDark ? "text-slate-100" : "text-gray-900"
                  }`}
                >
                  {loading ? (
                    <span
                      className={`inline-block h-7 w-7 animate-spin rounded-full border-2 ${
                        isDark
                          ? "border-slate-500 border-t-slate-200"
                          : "border-gray-300 border-t-gray-600"
                      }`}
                    />
                  ) : (
                    licenseOverdueTotal
                  )}
                </p>
              </div>
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                  isDark
                    ? "bg-amber-900/40 text-amber-300"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                <ShieldAlert className="h-5 w-5" />
              </span>
            </div>
          </div>
          <div
            className={`rounded-2xl border p-5 shadow-sm transition-colors ${
              isDark
                ? "border-slate-600 bg-gradient-to-br from-slate-800 to-slate-900"
                : "border-gray-200 bg-gradient-to-br from-white to-emerald-50/70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  Total
                </p>
                <p
                  className={`mt-2 ml-5 text-3xl font-bold [font-variant-numeric:tabular-nums] ${
                    isDark ? "text-slate-100" : "text-gray-900"
                  }`}
                >
                  {loading ? (
                    <span
                      className={`inline-block h-7 w-7 animate-spin rounded-full border-2 ${
                        isDark
                          ? "border-slate-500 border-t-slate-200"
                          : "border-gray-300 border-t-gray-600"
                      }`}
                    />
                  ) : (
                    total
                  )}
                </p>
              </div>
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                  isDark
                    ? "bg-emerald-900/40 text-emerald-300"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                <Sigma className="h-5 w-5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
