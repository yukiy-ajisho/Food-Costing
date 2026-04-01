"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Edit,
  Trash2,
  X,
  Save,
  Loader2,
  UploadCloud,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  companyRequirementsAPI,
  type CompanyRequirement,
} from "@/lib/api/reminder/company-requirements";
import {
  companyRequirementValueTypesAPI,
  type CompanyRequirementValueType,
} from "@/lib/api/reminder/company-requirement-value-types";
import {
  companyRequirementRealDataAPI,
  type CompanyRequirementRealDataRow,
} from "@/lib/api/reminder/company-requirement-real-data";
import { openPresignedDocumentInNewTab } from "@/lib/open-presigned-document";

type TabType = "status" | "documents";

/** Status タブ用: 最新 group の実データを value type 名でまとめたもの */
interface MappingEntry {
  dueDate: string | null;
  payDate: string | null;
  billDate: string | null;
  /** 数値のみ。単位は validityDurationUnit で判別 */
  validityDurationValue: string | null;
  /** その group で使っている Validity duration の単位 */
  validityDurationUnit: "years" | "months" | "days" | null;
  /** Estimated due date（specific または validity-based のどちらか一方） */
  estimatedDueDate: string | null;
  estimatedSpecificBillDate: string | null;
  estimatedBillDateValidityBased: string | null;
}

function getTodayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10);
}

function addYears(dateYmd: string, years: number): string {
  const d = new Date(dateYmd + "T12:00:00");
  const origMonth = d.getMonth();
  d.setFullYear(d.getFullYear() + years);
  if (d.getMonth() !== origMonth) {
    d.setDate(0);
  }
  return d.toISOString().slice(0, 10);
}

function addMonths(dateYmd: string, months: number): string {
  const d = new Date(dateYmd + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addDays(dateYmd: string, days: number): string {
  const d = new Date(dateYmd + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getStatus(expiration: string | null): "ok" | "overdue" | "none" {
  if (expiration == null || expiration === "") return "none";
  const today = getTodayYYYYMMDD();
  return expiration <= today ? "overdue" : "ok";
}

function formatExpirationDate(expiration: string): string {
  const d = new Date(expiration + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDetailSidebarBillDate(entry: MappingEntry | undefined): string {
  if (!entry) return "—";
  const ymd =
    (entry.billDate?.trim() && entry.billDate) ||
    (entry.estimatedSpecificBillDate?.trim() && entry.estimatedSpecificBillDate) ||
    (entry.estimatedBillDateValidityBased?.trim() &&
      entry.estimatedBillDateValidityBased) ||
    null;
  if (!ymd) return "—";
  return formatExpirationDate(ymd);
}

/** Expiration: due date or estimated due date (specific / validity-based). One of these exists per group. */
function getExpiration(
  _requirement: CompanyRequirement,
  entry: MappingEntry,
): string | null {
  const estimated = entry.estimatedDueDate ?? null;
  if (estimated && estimated.trim() !== "") return estimated;

  const dueDate = entry.dueDate ?? null;
  if (!dueDate || dueDate === "") return null;
  const v = entry.validityDurationValue;
  const unit = entry.validityDurationUnit;
  if (v == null || v === "" || !unit) return null;
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (unit === "years") return addYears(dueDate, n);
  if (unit === "months") return addMonths(dueDate, n);
  return addDays(dueDate, n);
}

interface AdminCompany {
  id: string;
  company_name: string;
}

export default function CompanyRequirementsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { selectedCompanyId, companies } = useCompany();

  const [activeTab, setActiveTab] = useState<TabType>("status");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [requirementSaving, setRequirementSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formCompanyId, setFormCompanyId] = useState("");
  // New requirement 用: 1年目（group_key=1）の初期値
  const [formInitialDueDate, setFormInitialDueDate] = useState("");
  const [formInitialBillDate, setFormInitialBillDate] = useState("");
  const [formInitialPayDate, setFormInitialPayDate] = useState("");
  const [formInitialPayNotPaid, setFormInitialPayNotPaid] = useState(true);
  type ValidityUnit = "years" | "months" | "days";
  const [formValidityUnit, setFormValidityUnit] =
    useState<ValidityUnit>("years");
  const [formValidityYears, setFormValidityYears] = useState("");
  const [formValidityMonths, setFormValidityMonths] = useState("");
  const [formValidityDays, setFormValidityDays] = useState("");

  // Add モーダル: 要件を作成できる会社（company_admin / company_director）。閲覧の選択はヘッダー CompanySelector と同期。
  const [adminCompanies, setAdminCompanies] = useState<AdminCompany[]>([]);
  const [statusRequirements, setStatusRequirements] = useState<
    CompanyRequirement[]
  >([]);
  const [valueTypes, setValueTypes] = useState<CompanyRequirementValueType[]>(
    [],
  );
  const [statusMapping, setStatusMapping] = useState<
    Record<string, MappingEntry>
  >({}); // requirementId -> { dueDate, payDate, billDate, validityDuration }
  const [statusMaxGroupKeyByReq, setStatusMaxGroupKeyByReq] = useState<
    Record<string, number>
  >({}); // requirementId -> 表示中の最新 group_key（Edit 保存先にも使用）
  /** 要件一覧取得中、または一覧取得後に real data 取得中（Current Status をまとめてロード扱いにする） */
  const [statusRequirementsLoading, setStatusRequirementsLoading] =
    useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  /** 選択会社について初回の status real data 取得が済んだら一致する ID（再取得時はフルスクリーンロードにしない） */
  const statusRealDataReadyCompanyIdRef = useRef<string | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Record Payment モード（テーブル外ボタンでオン、モーダル Save/Cancel でオフ）
  const [recordPaymentMode, setRecordPaymentMode] = useState(false);
  const [recordPaymentModalReqId, setRecordPaymentModalReqId] = useState<
    string | null
  >(null);
  const [recordPaymentPaymentMadeDate, setRecordPaymentPaymentMadeDate] =
    useState("");
  const [recordPaymentDueSpecific, setRecordPaymentDueSpecific] = useState("");
  const [recordPaymentDueValidityBased, setRecordPaymentDueValidityBased] =
    useState(false);
  const [recordPaymentBillSpecific, setRecordPaymentBillSpecific] =
    useState("");
  const [recordPaymentBillValidityBased, setRecordPaymentBillValidityBased] =
    useState(false);
  const [recordPaymentDueAccordionOpen, setRecordPaymentDueAccordionOpen] =
    useState(false);
  const [recordPaymentBillAccordionOpen, setRecordPaymentBillAccordionOpen] =
    useState(false);
  const [savingRecordPayment, setSavingRecordPayment] = useState(false);
  const [recordPaymentUploadFile, setRecordPaymentUploadFile] =
    useState<File | null>(null);
  // Documents タブ: 複数 requirement を同時展開可
  const [documentsExpandedIds, setDocumentsExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [documentsByReqId, setDocumentsByReqId] = useState<
    Record<string, { pay_date: string | null; key: string; file_name: string }[]>
  >({});
  const [documentsLoadingByReqId, setDocumentsLoadingByReqId] = useState<
    Record<string, boolean>
  >({});
  // Requirement 詳細モーダル（要件名クリックで開く）
  const [detailModalReqId, setDetailModalReqId] = useState<string | null>(null);
  const [detailModalEditMode, setDetailModalEditMode] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  // 詳細モーダル: 全 group の real_data / 選択中 group / その group のドキュメント一覧
  const [detailRealDataRows, setDetailRealDataRows] = useState<
    CompanyRequirementRealDataRow[] | null
  >(null);
  const [detailSelectedGroupKey, setDetailSelectedGroupKey] = useState<
    number | null
  >(null);
  const [detailDocuments, setDetailDocuments] = useState<
    { pay_date: string | null; key: string; file_name: string }[]
  >([]);
  const [detailDocumentsLoading, setDetailDocumentsLoading] = useState(false);
  const [detailUploadFile, setDetailUploadFile] = useState<File | null>(null);
  const [detailPendingDeleteKeys, setDetailPendingDeleteKeys] = useState<
    string[]
  >([]);
  const [detailUploadMode, setDetailUploadMode] = useState(false);
  const [detailUploadSaving, setDetailUploadSaving] = useState(false);
  // 詳細モーダル Edit 用のフォーム（Save で real_data に保存）
  const [detailEditDueDate, setDetailEditDueDate] = useState("");
  const [detailEditBillDate, setDetailEditBillDate] = useState("");
  const [detailEditPayDate, setDetailEditPayDate] = useState("");
  const [detailEditPayNotPaid, setDetailEditPayNotPaid] = useState(true);
  const [detailEditValidityUnit, setDetailEditValidityUnit] = useState<
    "years" | "months" | "days"
  >("years");
  const [detailEditValidityValue, setDetailEditValidityValue] = useState("");
  const [detailEditEstimatedDueDate, setDetailEditEstimatedDueDate] =
    useState("");

  const isPermissionErrorMessage = (message: string) => {
    return (
      message.includes("Forbidden: Insufficient permissions") ||
      message.includes("Access denied")
    );
  };

  const fetchAdminCompanies = useCallback(async () => {
    try {
      const data = await companyRequirementsAPI.getAdminCompanies();
      setAdminCompanies(data.companies ?? []);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load companies";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        setAdminCompanies([]);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === "status" || activeTab === "documents") {
      fetchAdminCompanies();
    }
  }, [activeTab, fetchAdminCompanies]);

  // Value types を取得（List の Add モーダル・Status・Documents タブで利用）
  useEffect(() => {
    if (activeTab !== "status" && activeTab !== "documents") return;
    companyRequirementValueTypesAPI
      .getAll()
      .then(setValueTypes)
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Failed to load value types";
        if (isPermissionErrorMessage(message)) {
          setPermissionDenied(true);
        } else {
          setValueTypes([]);
        }
      });
  }, [activeTab]);

  // 選択会社の要件一覧を取得（Status と Documents で共通利用）
  useEffect(() => {
    if (
      (activeTab !== "status" && activeTab !== "documents") ||
      !selectedCompanyId
    ) {
      setStatusRequirements([]);
      setStatusRequirementsLoading(false);
      statusRealDataReadyCompanyIdRef.current = null;
      return;
    }
    statusRealDataReadyCompanyIdRef.current = null;
    setStatusRequirementsLoading(true);
    setStatusRequirements([]);
    companyRequirementsAPI
      .getAll(selectedCompanyId)
      .then((list) => {
        setStatusRequirements(list);
        if (list.length === 0 || activeTab !== "status") {
          setStatusRequirementsLoading(false);
        }
      })
      .catch((err) => {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to load status requirements";
        if (isPermissionErrorMessage(message)) {
          setPermissionDenied(true);
        } else {
          setStatusRequirements([]);
        }
        setStatusRequirementsLoading(false);
      });
  }, [activeTab, selectedCompanyId]);

  useEffect(() => {
    setDocumentsExpandedIds(new Set());
    setDocumentsByReqId({});
    setDocumentsLoadingByReqId({});
  }, [selectedCompanyId]);

  const fetchStatusData = useCallback(
    async (options?: { background?: boolean }) => {
      if (!selectedCompanyId || statusRequirements.length === 0) {
        setStatusMapping({});
        setStatusMaxGroupKeyByReq({});
        return;
      }
      const background = options?.background ?? false;
      setStatusError(null);
      if (background) {
        setStatusRefreshing(true);
      } else {
        setStatusLoading(true);
      }
      try {
        const requirementIds = statusRequirements.map((r) => r.id);
        if (requirementIds.length === 0) {
          setStatusMapping({});
          setStatusMaxGroupKeyByReq({});
          return;
        }
        const realData =
          await companyRequirementRealDataAPI.getByRequirementIds(
            requirementIds,
          );
        const nameById = Object.fromEntries(
          valueTypes.map((vt) => [vt.id, vt.name]),
        );
        const rows = realData as CompanyRequirementRealDataRow[];
        const maxGroupKeyByReq: Record<string, number> = {};
        for (const row of rows) {
          const rid = row.company_requirement_id;
          const current = maxGroupKeyByReq[rid];
          if (current === undefined || row.group_key > current) {
            maxGroupKeyByReq[rid] = row.group_key;
          }
        }
        const map: Record<string, MappingEntry> = {};
        for (const rid of requirementIds) {
          map[rid] = {
            dueDate: null,
            payDate: null,
            billDate: null,
            validityDurationValue: null,
            validityDurationUnit: null,
            estimatedDueDate: null,
            estimatedSpecificBillDate: null,
            estimatedBillDateValidityBased: null,
          };
        }
        for (const row of rows) {
          const latestGroup = maxGroupKeyByReq[row.company_requirement_id];
          if (latestGroup === undefined || row.group_key !== latestGroup)
            continue;
          const name = nameById[row.type_id];
          const entry = map[row.company_requirement_id];
          if (!entry) continue;
          if (name === "Due date") entry.dueDate = row.value ?? null;
          else if (name === "Pay date") entry.payDate = row.value ?? null;
          else if (name === "Bill date") entry.billDate = row.value ?? null;
          else if (name === "Validity duration (years)") {
            entry.validityDurationValue = row.value ?? null;
            entry.validityDurationUnit = "years";
          } else if (name === "Validity duration (months)") {
            entry.validityDurationValue = row.value ?? null;
            entry.validityDurationUnit = "months";
          } else if (name === "Validity duration (days)") {
            entry.validityDurationValue = row.value ?? null;
            entry.validityDurationUnit = "days";
          } else if (name === "Estimated specific due date") {
            entry.estimatedDueDate = row.value ?? null;
          } else if (
            name === "Estimated due date based on validity duration" &&
            entry.estimatedDueDate == null
          ) {
            entry.estimatedDueDate = row.value ?? null;
          }
        }
        setStatusMapping(map);
        setStatusMaxGroupKeyByReq(maxGroupKeyByReq);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load status data";
        if (isPermissionErrorMessage(message)) {
          setPermissionDenied(true);
        } else {
          setStatusError(message);
        }
      } finally {
        if (background) {
          setStatusRefreshing(false);
        } else {
          setStatusLoading(false);
          setStatusRequirementsLoading(false);
          if (selectedCompanyId) {
            statusRealDataReadyCompanyIdRef.current = selectedCompanyId;
          }
        }
      }
    },
    [selectedCompanyId, statusRequirements, valueTypes],
  );

  useEffect(() => {
    if (activeTab !== "status") return;
    fetchStatusData();
  }, [activeTab, fetchStatusData]);

  // 詳細モーダルを開いたときに real_data を取得し、選択 group を最新に
  useEffect(() => {
    if (!detailModalReqId) {
      setDetailRealDataRows(null);
      setDetailSelectedGroupKey(null);
      setDetailDocuments([]);
      setDetailUploadFile(null);
      setDetailPendingDeleteKeys([]);
      return;
    }
    companyRequirementRealDataAPI
      .getByRequirementIds([detailModalReqId])
      .then((rows) => {
        setDetailRealDataRows(rows as CompanyRequirementRealDataRow[]);
        const keys = [
          ...new Set(
            (rows as CompanyRequirementRealDataRow[]).map((r) => r.group_key),
          ),
        ].sort((a, b) => b - a);
        setDetailSelectedGroupKey(keys[0] ?? null);
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Failed to load detail data";
        if (isPermissionErrorMessage(message)) {
          setPermissionDenied(true);
        } else {
          setDetailRealDataRows([]);
          setDetailSelectedGroupKey(null);
        }
      });
  }, [detailModalReqId]);

  const detailGroupKeys = useMemo(() => {
    if (!detailRealDataRows?.length) return [];
    return [...new Set(detailRealDataRows.map((r) => r.group_key))].sort(
      (a, b) => b - a,
    );
  }, [detailRealDataRows]);

  const detailEntryByGroup = useMemo(() => {
    if (!detailRealDataRows?.length || !valueTypes.length)
      return {} as Record<number, MappingEntry>;
    const nameById = Object.fromEntries(
      valueTypes.map((vt) => [vt.id, vt.name]),
    );
    const byGroup: Record<number, MappingEntry> = {};
    for (const row of detailRealDataRows) {
      const gk = row.group_key;
      if (!byGroup[gk]) {
        byGroup[gk] = {
          dueDate: null,
          payDate: null,
          billDate: null,
          validityDurationValue: null,
          validityDurationUnit: null,
          estimatedDueDate: null,
          estimatedSpecificBillDate: null,
          estimatedBillDateValidityBased: null,
        };
      }
      const name = nameById[row.type_id];
      const e = byGroup[gk]!;
      if (name === "Due date") e.dueDate = row.value ?? null;
      else if (name === "Pay date") e.payDate = row.value ?? null;
      else if (name === "Bill date") e.billDate = row.value ?? null;
      else if (name === "Validity duration (years)") {
        e.validityDurationValue = row.value ?? null;
        e.validityDurationUnit = "years";
      } else if (name === "Validity duration (months)") {
        e.validityDurationValue = row.value ?? null;
        e.validityDurationUnit = "months";
      } else if (name === "Validity duration (days)") {
        e.validityDurationValue = row.value ?? null;
        e.validityDurationUnit = "days";
      } else if (name === "Estimated specific due date")
        e.estimatedDueDate = row.value ?? null;
      else if (
        name === "Estimated due date based on validity duration" &&
        e.estimatedDueDate == null
      ) {
        e.estimatedDueDate = row.value ?? null;
      } else if (name === "Estimated specific bill date") {
        e.estimatedSpecificBillDate = row.value ?? null;
      } else if (
        name === "Estimated bill date based on validity duration" &&
        e.estimatedBillDateValidityBased == null
      ) {
        e.estimatedBillDateValidityBased = row.value ?? null;
      }
    }
    return byGroup;
  }, [detailRealDataRows, valueTypes]);

  // 選択中 group のドキュメント一覧を取得
  useEffect(() => {
    if (!detailModalReqId || detailSelectedGroupKey == null) {
      setDetailDocuments([]);
      return;
    }
    setDetailDocumentsLoading(true);
    companyRequirementRealDataAPI
      .getDocuments(detailModalReqId, detailSelectedGroupKey)
      .then(setDetailDocuments)
      .catch(() => setDetailDocuments([]))
      .finally(() => setDetailDocumentsLoading(false));
  }, [detailModalReqId, detailSelectedGroupKey]);

  // 左で選択した group が変わったとき、Edit 中ならフォームをその group の値で更新
  useEffect(() => {
    if (!detailModalEditMode || detailSelectedGroupKey == null) return;
    const entry = detailEntryByGroup[detailSelectedGroupKey];
    if (!entry) return;
    setDetailEditDueDate(entry.dueDate ?? "");
    setDetailEditBillDate(entry.billDate ?? "");
    setDetailEditPayDate(entry.payDate ?? "");
    setDetailEditPayNotPaid(!entry.payDate);
    setDetailEditValidityUnit(entry.validityDurationUnit ?? "years");
    setDetailEditValidityValue(entry.validityDurationValue ?? "");
    setDetailEditEstimatedDueDate(entry.estimatedDueDate ?? "");
  }, [detailSelectedGroupKey, detailModalEditMode, detailEntryByGroup]);

  const handleSaveDetailUpload = async () => {
    if (
      !detailModalReqId ||
      detailSelectedGroupKey == null ||
      !detailUploadFile
    )
      return;
    setDetailUploadSaving(true);
    try {
      await companyRequirementRealDataAPI.uploadDocument(
        detailModalReqId,
        detailSelectedGroupKey,
        detailUploadFile,
      );
      setDetailUploadFile(null);
      const list = await companyRequirementRealDataAPI.getDocuments(
        detailModalReqId,
        detailSelectedGroupKey,
      );
      setDetailDocuments(list);
      await fetchStatusData({ background: true });
      const fresh = await companyRequirementRealDataAPI.getByRequirementIds([
        detailModalReqId,
      ]);
      setDetailRealDataRows(fresh as CompanyRequirementRealDataRow[]);
      setDetailUploadMode(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to upload document";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setDetailUploadSaving(false);
    }
  };

  /** 詳細モーダルで Edit を押したときにフォームを現在値で初期化 */
  const openDetailEditMode = () => {
    if (!detailModalReqId || detailSelectedGroupKey == null) return;
    const entry = detailEntryByGroup[detailSelectedGroupKey] ??
      statusMapping[detailModalReqId] ?? {
        dueDate: null,
        payDate: null,
        billDate: null,
        validityDurationValue: null,
        validityDurationUnit: null,
        estimatedDueDate: null,
        estimatedSpecificBillDate: null,
        estimatedBillDateValidityBased: null,
      };
    setDetailEditDueDate(entry.dueDate ?? "");
    setDetailEditBillDate(entry.billDate ?? "");
    setDetailEditPayDate(entry.payDate ?? "");
    setDetailEditPayNotPaid(!entry.payDate);
    setDetailEditValidityUnit(entry.validityDurationUnit ?? "years");
    setDetailEditValidityValue(entry.validityDurationValue ?? "");
    setDetailEditEstimatedDueDate(entry.estimatedDueDate ?? "");
    setDetailPendingDeleteKeys([]);
    setDetailModalEditMode(true);
  };

  /** 詳細モーダルで Save を押したときに real_data とドキュメントを更新 */
  const handleSaveDetailModal = async () => {
    if (
      !detailModalReqId ||
      detailSelectedGroupKey == null ||
      valueTypes.length === 0
    )
      return;
    const groupKey = detailSelectedGroupKey;
    const idByName = Object.fromEntries(
      valueTypes.map((vt) => [vt.name, vt.id]),
    );
    const rows: Array<{
      company_requirement_id: string;
      group_key: number;
      type_id: string;
      value: string | null;
    }> = [];
    const push = (name: string, value: string | null) => {
      const typeId = idByName[name];
      if (typeId)
        rows.push({
          company_requirement_id: detailModalReqId,
          group_key: groupKey,
          type_id: typeId,
          value: value && value.trim() ? value.trim() : null,
        });
    };
    push("Due date", detailEditDueDate.trim() || null);
    push("Bill date", detailEditBillDate.trim() || null);
    if (!detailEditPayNotPaid && detailEditPayDate.trim())
      push("Pay date", detailEditPayDate.trim() || null);
    else if (detailEditPayNotPaid) {
      // 未払いにした場合は Pay date を null で更新するため、既存行を上書きするには同じ type_id で value=null を送る必要がある
      push("Pay date", null);
    }
    const validityVal = detailEditValidityValue.trim() || null;
    push(
      "Validity duration (years)",
      detailEditValidityUnit === "years" ? validityVal : null,
    );
    push(
      "Validity duration (months)",
      detailEditValidityUnit === "months" ? validityVal : null,
    );
    push(
      "Validity duration (days)",
      detailEditValidityUnit === "days" ? validityVal : null,
    );
    push(
      "Estimated specific due date",
      detailEditEstimatedDueDate.trim() || null,
    );
    push("Estimated due date based on validity duration", null);
    setSavingDetail(true);
    try {
      await companyRequirementRealDataAPI.saveRows(rows);
      if (detailPendingDeleteKeys.length > 0) {
        await Promise.all(
          detailPendingDeleteKeys.map((key) =>
            companyRequirementRealDataAPI.deleteDocument(key),
          ),
        );
      }
      await fetchStatusData({ background: true });
      const fresh = await companyRequirementRealDataAPI.getByRequirementIds([
        detailModalReqId,
      ]);
      setDetailRealDataRows(fresh as CompanyRequirementRealDataRow[]);
      if (detailSelectedGroupKey != null) {
        const docs = await companyRequirementRealDataAPI.getDocuments(
          detailModalReqId,
          detailSelectedGroupKey,
        );
        setDetailDocuments(docs);
      }
      setDetailPendingDeleteKeys([]);
      setDetailModalEditMode(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setSavingDetail(false);
    }
  };

  const handleCancelRecordPayment = () => {
    setRecordPaymentMode(false);
    setRecordPaymentModalReqId(null);
    setRecordPaymentPaymentMadeDate("");
    setRecordPaymentDueSpecific("");
    setRecordPaymentDueValidityBased(false);
    setRecordPaymentBillSpecific("");
    setRecordPaymentBillValidityBased(false);
    setRecordPaymentDueAccordionOpen(false);
    setRecordPaymentBillAccordionOpen(false);
    setRecordPaymentUploadFile(null);
  };

  const handleSaveRecordPayment = async () => {
    if (!recordPaymentModalReqId || valueTypes.length === 0) return;
    const paymentMade = recordPaymentPaymentMadeDate.trim();
    if (!paymentMade) {
      alert("Payment made date is required");
      return;
    }
    setSavingRecordPayment(true);
    try {
      const realData = await companyRequirementRealDataAPI.getByRequirementIds([
        recordPaymentModalReqId,
      ]);
      const rows = realData as CompanyRequirementRealDataRow[];
      const maxGroupKey =
        rows.length > 0 ? Math.max(...rows.map((r) => r.group_key)) : 0;
      const entry = statusMapping[recordPaymentModalReqId] ?? {
        dueDate: null,
        payDate: null,
        billDate: null,
        validityDurationValue: null,
        validityDurationUnit: null,
        estimatedDueDate: null,
        estimatedSpecificBillDate: null,
        estimatedBillDateValidityBased: null,
      };
      const idByName = Object.fromEntries(
        valueTypes.map((vt) => [vt.name, vt.id]),
      );
      const newRows: Array<{
        company_requirement_id: string;
        group_key: number;
        type_id: string;
        value: string | null;
      }> = [];
      const push = (groupKey: number, name: string, value: string | null) => {
        const typeId = idByName[name];
        if (typeId)
          newRows.push({
            company_requirement_id: recordPaymentModalReqId,
            group_key: groupKey,
            type_id: typeId,
            value: value && value.trim() ? value.trim() : null,
          });
      };
      // Group n: Pay date (payment made date)
      push(maxGroupKey, "Pay date", paymentMade);
      // Group n+1: Estimated due & bill (user's choice)
      const nextGroupKey = maxGroupKey + 1;
      const dueVal = recordPaymentDueValidityBased
        ? entry.dueDate &&
          entry.validityDurationValue &&
          entry.validityDurationUnit
          ? (() => {
              const n = parseInt(entry.validityDurationValue, 10);
              if (!Number.isInteger(n) || n <= 0) return null;
              if (entry.validityDurationUnit === "years")
                return addYears(entry.dueDate!, n);
              if (entry.validityDurationUnit === "months")
                return addMonths(entry.dueDate!, n);
              return addDays(entry.dueDate!, n);
            })()
          : null
        : recordPaymentDueSpecific.trim() || null;
      const billVal = recordPaymentBillValidityBased
        ? entry.billDate &&
          entry.validityDurationValue &&
          entry.validityDurationUnit
          ? (() => {
              const n = parseInt(entry.validityDurationValue, 10);
              if (!Number.isInteger(n) || n <= 0) return null;
              if (entry.validityDurationUnit === "years")
                return addYears(entry.billDate!, n);
              if (entry.validityDurationUnit === "months")
                return addMonths(entry.billDate!, n);
              return addDays(entry.billDate!, n);
            })()
          : null
        : recordPaymentBillSpecific.trim() || null;
      if (recordPaymentDueValidityBased && dueVal) {
        push(
          nextGroupKey,
          "Estimated due date based on validity duration",
          dueVal,
        );
      } else if (
        !recordPaymentDueValidityBased &&
        recordPaymentDueSpecific.trim()
      ) {
        push(nextGroupKey, "Estimated specific due date", dueVal);
      }
      if (recordPaymentBillValidityBased && billVal) {
        push(
          nextGroupKey,
          "Estimated bill date based on validity duration",
          billVal,
        );
      } else if (
        !recordPaymentBillValidityBased &&
        recordPaymentBillSpecific.trim()
      ) {
        push(nextGroupKey, "Estimated specific bill date", billVal);
      }
      await companyRequirementRealDataAPI.saveRecordPayment(
        newRows,
        recordPaymentUploadFile,
      );
      handleCancelRecordPayment();
      await fetchStatusData({ background: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save record payment";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setSavingRecordPayment(false);
    }
  };

  const openNewModal = () => {
    setEditingId(null);
    setFormTitle("");
    setFormCompanyId(selectedCompanyId ?? "");
    setFormInitialDueDate("");
    setFormInitialBillDate("");
    setFormInitialPayDate("");
    setFormInitialPayNotPaid(true);
    setFormValidityUnit("years");
    setFormValidityYears("");
    setFormValidityMonths("");
    setFormValidityDays("");
    setModalOpen(true);
  };

  const openEditModal = (r: CompanyRequirement) => {
    setEditingId(r.id);
    setFormTitle(r.title);
    setFormCompanyId(r.companyId);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) {
      alert("Title is required");
      return;
    }
    if (!editingId && !formCompanyId) {
      alert("Please select a company");
      return;
    }
    setRequirementSaving(true);
    try {
      if (editingId) {
        await companyRequirementsAPI.update(editingId, {
          title: formTitle.trim(),
        });
      } else {
        const created = await companyRequirementsAPI.create({
          title: formTitle.trim(),
          company_id: formCompanyId,
        });
        // 新規作成時: group_key=1 の実データを保存（仕様パターン 1 または 2）
        if (valueTypes.length > 0) {
          const idByName = Object.fromEntries(
            valueTypes.map((vt) => [vt.name, vt.id]),
          );
          const GROUP_KEY = 1;
          const rows: Array<{
            company_requirement_id: string;
            group_key: number;
            type_id: string;
            value: string | null;
          }> = [];
          const push = (name: string, value: string | null) => {
            const typeId = idByName[name];
            if (typeId)
              rows.push({
                company_requirement_id: created.id,
                group_key: GROUP_KEY,
                type_id: typeId,
                value: value && value.trim() ? value.trim() : null,
              });
          };
          push("Due date", formInitialDueDate.trim() || null);
          push("Bill date", formInitialBillDate.trim() || null);
          if (!formInitialPayNotPaid && formInitialPayDate.trim())
            push("Pay date", formInitialPayDate.trim() || null);
          const validityNum =
            formValidityUnit === "years"
              ? formValidityYears.trim()
              : formValidityUnit === "months"
                ? formValidityMonths.trim()
                : formValidityDays.trim();
          if (validityNum) {
            const validityType =
              formValidityUnit === "years"
                ? "Validity duration (years)"
                : formValidityUnit === "months"
                  ? "Validity duration (months)"
                  : "Validity duration (days)";
            push(validityType, validityNum);
          }
          // パターン 2: すでに払っている → Estimated due/bill based on validity duration
          if (!formInitialPayNotPaid && formInitialPayDate.trim()) {
            const dueDate = formInitialDueDate.trim();
            const billDate = formInitialBillDate.trim();
            const v = parseInt(validityNum, 10);
            if (dueDate && Number.isInteger(v) && v > 0) {
              const estDue =
                formValidityUnit === "years"
                  ? addYears(dueDate, v)
                  : formValidityUnit === "months"
                    ? addMonths(dueDate, v)
                    : addDays(dueDate, v);
              push("Estimated due date based on validity duration", estDue);
            }
            if (billDate && Number.isInteger(v) && v > 0) {
              const estBill =
                formValidityUnit === "years"
                  ? addYears(billDate, v)
                  : formValidityUnit === "months"
                    ? addMonths(billDate, v)
                    : addDays(billDate, v);
              push("Estimated bill date based on validity duration", estBill);
            }
          }
          if (rows.length > 0) {
            await companyRequirementRealDataAPI.saveRows(rows);
          }
        }
      }
      closeModal();
      if (selectedCompanyId && formCompanyId === selectedCompanyId) {
        const list = await companyRequirementsAPI.getAll(selectedCompanyId);
        setStatusRequirements(list);
        await fetchStatusData({ background: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    } finally {
      setRequirementSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this requirement?")
    )
      return;
    try {
      await companyRequirementsAPI.delete(id);
      if (selectedCompanyId) {
        const list = await companyRequirementsAPI.getAll(selectedCompanyId);
        setStatusRequirements(list);
        await fetchStatusData({ background: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      if (isPermissionErrorMessage(message)) {
        setPermissionDenied(true);
      } else {
        alert(message);
      }
    }
  };

  const modalTitle = editingId
    ? (statusRequirements.find((r) => r.id === editingId)?.title ??
      "Edit Requirement")
    : "New Requirement";
  const isNewRequirement = !editingId;

  /** Current Status: 会社切替や初回表示では一覧＋real data までフルロード。valueTypes 到着などの再取得ではテーブルを隠さない */
  const statusPanelFullBleedLoading =
    !!selectedCompanyId &&
    (statusRequirementsLoading ||
      (statusLoading &&
        statusRealDataReadyCompanyIdRef.current !== selectedCompanyId));

  if (permissionDenied) {
    return (
      <div className="px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            You don&apos;t have permission.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        <div
          className={`pt-4 mb-4 border-b transition-colors ${
            isDark ? "border-slate-700" : "border-gray-200"
          }`}
        >
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab("status")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "status"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Current Status
            </button>
            <button
              onClick={() => setActiveTab("documents")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "documents"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Documents
            </button>
          </nav>
        </div>

        {activeTab === "status" && (
          <div className="space-y-6 relative">
            {recordPaymentMode && (
              <div
                className="fixed inset-0 bg-black/50 z-40"
                aria-hidden
                style={{ pointerEvents: "none" }}
              />
            )}

            {statusPanelFullBleedLoading && (
              <div
                className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
              >
                Loading status...
              </div>
            )}
            {!statusPanelFullBleedLoading && statusError && (
              <div className="text-red-600 dark:text-red-400 text-sm">
                {statusError}
              </div>
            )}
            {!statusPanelFullBleedLoading &&
              !statusError &&
              !selectedCompanyId && (
                <div
                  className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                >
                  Select a company in the header to view status.
                </div>
              )}
            {!statusPanelFullBleedLoading &&
              !statusError &&
              selectedCompanyId && (
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex w-full items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={openNewModal}
                      disabled={!selectedCompanyId || recordPaymentMode}
                      title={
                        !selectedCompanyId
                          ? "Select a company in the header first"
                          : recordPaymentMode
                            ? "Exit Record Payment to add"
                            : undefined
                      }
                      className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors shrink-0 ${
                        isDark
                          ? "bg-slate-600 hover:bg-slate-500 disabled:opacity-50 disabled:pointer-events-none"
                          : "bg-gray-600 hover:bg-gray-700 disabled:opacity-50 disabled:pointer-events-none"
                      }`}
                    >
                      <Plus className="w-5 h-5" />
                      Add
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusRequirements.length > 0 &&
                        (recordPaymentMode ? (
                          <button
                            type="button"
                            onClick={handleCancelRecordPayment}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                          >
                            <X className="w-4 h-4" />
                            Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRecordPaymentMode(true)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-600 text-white hover:bg-gray-700"}`}
                          >
                            Record Payment
                          </button>
                        ))}
                    </div>
                  </div>
                  {statusRequirements.length === 0 ? (
                    <div
                      className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
                    >
                      No requirements for this company. Use Add to create one.
                    </div>
                  ) : (
                  <div
                    className={`rounded-lg shadow-sm border overflow-x-auto transition-colors w-full ${recordPaymentMode ? "relative z-50" : ""} ${
                      isDark
                        ? "bg-slate-800 border-slate-700"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <table
                      className="w-full"
                      style={{ tableLayout: "auto", minWidth: "min-content" }}
                    >
                      <thead className={isDark ? "bg-slate-700" : "bg-gray-50"}>
                        <tr>
                          <th
                            className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                            style={{ minWidth: 160 }}
                          >
                            Requirement name
                          </th>
                          <th
                            className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                            style={{ minWidth: 80 }}
                          >
                            Status
                          </th>
                          <th
                            className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-300" : "text-gray-500"}`}
                            style={{ minWidth: 120 }}
                          >
                            Due date
                          </th>
                        </tr>
                      </thead>
                      <tbody
                        style={{
                          borderTop: isDark
                            ? "1px solid #334155"
                            : "1px solid #e5e7eb",
                        }}
                      >
                        {statusRequirements.map((req) => {
                          const entry = statusMapping[req.id] ?? {
                            dueDate: null,
                            payDate: null,
                            billDate: null,
                            validityDurationValue: null,
                            validityDurationUnit: null,
                            estimatedDueDate: null,
                            estimatedSpecificBillDate: null,
                            estimatedBillDateValidityBased: null,
                          };
                          const expiration = getExpiration(req, entry);
                          const status = getStatus(expiration);
                          const isDimmed =
                            recordPaymentMode &&
                            recordPaymentModalReqId !== req.id;
                          return (
                            <tr
                              key={req.id}
                              className={`${isDark ? "border-b border-slate-700" : "border-b border-gray-200"} ${recordPaymentMode ? "cursor-pointer" : ""} ${recordPaymentMode ? "hover:ring-2 hover:ring-blue-500 hover:ring-inset" : ""}`}
                              onClick={
                                recordPaymentMode
                                  ? () => {
                                      setRecordPaymentModalReqId(req.id);
                                      setRecordPaymentPaymentMadeDate("");
                                      setRecordPaymentDueSpecific("");
                                      setRecordPaymentDueValidityBased(false);
                                      setRecordPaymentBillSpecific("");
                                      setRecordPaymentBillValidityBased(false);
                                      setRecordPaymentDueAccordionOpen(false);
                                      setRecordPaymentBillAccordionOpen(false);
                                      setRecordPaymentUploadFile(null);
                                    }
                                  : undefined
                              }
                              role={recordPaymentMode ? "button" : undefined}
                            >
                              <td
                                className={`px-4 py-3 ${isDark ? "text-slate-200" : "text-gray-900"}`}
                                style={{ minWidth: 200 }}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`font-medium min-w-0 truncate ${recordPaymentMode ? "" : "cursor-pointer hover:underline"}`}
                                    onClick={
                                      recordPaymentMode
                                        ? undefined
                                        : (e) => {
                                            e.stopPropagation();
                                            setDetailModalReqId(req.id);
                                            setDetailModalEditMode(false);
                                          }
                                    }
                                    role={
                                      recordPaymentMode ? undefined : "button"
                                    }
                                    onKeyDown={
                                      recordPaymentMode
                                        ? undefined
                                        : (e) => {
                                            if (
                                              e.key === "Enter" ||
                                              e.key === " "
                                            ) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              setDetailModalReqId(req.id);
                                              setDetailModalEditMode(false);
                                            }
                                          }
                                    }
                                    tabIndex={recordPaymentMode ? undefined : 0}
                                  >
                                    {req.title}
                                  </span>
                                  {!recordPaymentMode && (
                                    <span className="hidden">
                                      <span className="shrink-0 flex items-center gap-0.5 ml-auto">
                                        <button
                                          type="button"
                                          aria-label="Edit requirement"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openEditModal(req);
                                          }}
                                          className={`p-1.5 rounded-md transition-colors ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-200"}`}
                                        >
                                          <Edit className="w-4 h-4" />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label="Delete requirement"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDelete(req.id);
                                          }}
                                          className={`p-1.5 rounded-md transition-colors ${isDark ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-200"}`}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td
                                className={`px-4 py-3 ${isDimmed ? "opacity-40" : ""}`}
                              >
                                {statusRefreshing ? (
                                  <Loader2 className="w-5 h-5 animate-spin inline-block" />
                                ) : (
                                  <span
                                    className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${status === "ok" ? "bg-green-500" : status === "overdue" ? "bg-red-500" : "bg-gray-400"}`}
                                    title={
                                      expiration
                                        ? `Expiration: ${formatExpirationDate(expiration)}`
                                        : "No expiration date"
                                    }
                                  />
                                )}
                              </td>
                              <td
                                className={`px-4 py-3 ${isDark ? "text-slate-300" : "text-gray-700"} ${isDimmed ? "opacity-40" : ""}`}
                              >
                                {(() => {
                                  const formatDate = (s: string) => {
                                    const d = new Date(s + "T12:00:00");
                                    return d.toLocaleDateString(undefined, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    });
                                  };
                                  if (entry.estimatedDueDate) {
                                    return (
                                      <>
                                        {formatDate(entry.estimatedDueDate)}
                                        <span
                                          className={`ml-1 text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                                        >
                                          *estimated due date
                                        </span>
                                      </>
                                    );
                                  }
                                  if (entry.dueDate) {
                                    return formatDate(entry.dueDate);
                                  }
                                  return "—";
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              )}
          </div>
        )}

        {activeTab === "documents" && (
          <div className="space-y-6">
            {!selectedCompanyId || statusRequirements.length === 0 ? (
              <div
                className={`text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
              >
                {!selectedCompanyId
                  ? "Select a company in the header to view documents."
                  : "No requirements for this company."}
              </div>
            ) : (
              <div
                className={`rounded-lg shadow-sm border overflow-hidden transition-colors ${
                  isDark
                    ? "bg-slate-800 border-slate-700"
                    : "bg-white border-gray-200"
                }`}
              >
                <ul className="divide-y divide-gray-200 dark:divide-slate-700">
                  {statusRequirements.map((req) => {
                    const isExpanded = documentsExpandedIds.has(req.id);
                    const docList = documentsByReqId[req.id];
                    const docLoading = documentsLoadingByReqId[req.id] === true;
                    return (
                      <li
                        key={req.id}
                        className={isDark ? "bg-slate-800" : "bg-white"}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const id = req.id;
                            if (documentsExpandedIds.has(id)) {
                              setDocumentsExpandedIds((prev) => {
                                const n = new Set(prev);
                                n.delete(id);
                                return n;
                              });
                              return;
                            }
                            setDocumentsExpandedIds(
                              (prev) => new Set(prev).add(id),
                            );
                            setDocumentsLoadingByReqId((m) => ({
                              ...m,
                              [id]: true,
                            }));
                            companyRequirementRealDataAPI
                              .getDocuments(id)
                              .then((list) => {
                                setDocumentsByReqId((m) => ({
                                  ...m,
                                  [id]: list,
                                }));
                              })
                              .catch(() => {
                                setDocumentsByReqId((m) => ({
                                  ...m,
                                  [id]: [],
                                }));
                              })
                              .finally(() => {
                                setDocumentsLoadingByReqId((m) => ({
                                  ...m,
                                  [id]: false,
                                }));
                              });
                          }}
                          className={`w-full px-4 py-3 text-left flex items-center justify-between font-medium ${isDark ? "text-slate-200 hover:bg-slate-700" : "text-gray-900 hover:bg-gray-50"}`}
                        >
                          <span>{req.title}</span>
                          <span
                            className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        </button>
                        {isExpanded && (
                          <div
                            className={`px-4 pb-3 ${isDark ? "bg-slate-800" : "bg-gray-50"}`}
                          >
                            {docLoading ? (
                              <div
                                className={`text-sm py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                              >
                                Loading...
                              </div>
                            ) : (docList ?? []).length === 0 ? (
                              <div
                                className={`text-sm py-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                              >
                                No documents for this requirement.
                              </div>
                            ) : (
                              <ul className="space-y-1.5">
                                {(docList ?? []).map((doc, idx) => {
                                  const label =
                                    doc.file_name ||
                                    doc.key.split("/").pop() ||
                                    `Document ${idx + 1}`;
                                  const payDateLabel = doc.pay_date
                                    ? new Date(
                                        doc.pay_date + "T12:00:00",
                                      ).toLocaleDateString(undefined, {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                      })
                                    : "—";
                                  return (
                                    <li
                                      key={doc.key}
                                      className={`flex items-center gap-3 text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}
                                    >
                                      <span
                                        className={`shrink-0 w-24 ${isDark ? "text-slate-500" : "text-gray-500"}`}
                                      >
                                        {payDateLabel}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openPresignedDocumentInNewTab(() =>
                                            companyRequirementRealDataAPI.getDocumentUrl(
                                              doc.key,
                                            ),
                                          );
                                        }}
                                        className={`text-blue-600 hover:underline dark:text-blue-400 ${isDark ? "hover:text-blue-300" : "hover:text-blue-700"}`}
                                      >
                                        {label}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div
              className={`rounded-xl shadow-xl w-full mx-4 overflow-visible ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}
              style={{ maxWidth: "min(32rem, 90vw)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`px-8 py-5 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}
              >
                <h3
                  className={`text-xl font-semibold ${isDark ? "text-slate-100" : "text-gray-900"}`}
                >
                  {modalTitle}
                </h3>
              </div>
              <div className="p-8 space-y-5">
                {isNewRequirement && (
                  <div>
                    <label
                      className={`block text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                    >
                      Company
                    </label>
                    <select
                      value={formCompanyId}
                      onChange={(e) => setFormCompanyId(e.target.value)}
                      className={`w-full px-4 py-2.5 rounded-lg border text-base ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                    >
                      <option value="">Select...</option>
                      {adminCompanies.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.company_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label
                    className={`block text-base font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                  >
                    Title
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-lg border text-base ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                    placeholder="e.g. Business license"
                  />
                </div>
                {isNewRequirement && (
                  <>
                    <div
                      className={`border-t pt-4 ${isDark ? "border-slate-700" : "border-gray-200"}`}
                    />
                    <div>
                      <label
                        className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Latest bill date
                      </label>
                      <input
                        type="date"
                        value={formInitialBillDate}
                        onChange={(e) => setFormInitialBillDate(e.target.value)}
                        className={`w-full px-4 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                      />
                    </div>
                    <div>
                      <label
                        className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Latest due date
                      </label>
                      <input
                        type="date"
                        value={formInitialDueDate}
                        onChange={(e) => setFormInitialDueDate(e.target.value)}
                        className={`w-full px-4 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                      />
                    </div>
                    <div>
                      <label
                        className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Latest pay date
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="payStatus"
                            checked={formInitialPayNotPaid}
                            onChange={() => {
                              setFormInitialPayNotPaid(true);
                              setFormInitialPayDate("");
                            }}
                            className="w-4 h-4"
                          />
                          <span>Not paid yet</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="payStatus"
                            checked={!formInitialPayNotPaid}
                            onChange={() => setFormInitialPayNotPaid(false)}
                            className="w-4 h-4"
                          />
                          <span>Paid</span>
                        </label>
                        {!formInitialPayNotPaid && (
                          <input
                            type="date"
                            value={formInitialPayDate}
                            onChange={(e) =>
                              setFormInitialPayDate(e.target.value)
                            }
                            className={`w-full px-4 py-2 rounded-lg border text-sm mt-1 ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                          />
                        )}
                      </div>
                    </div>
                    <div>
                      <label
                        className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Validity duration
                      </label>
                      <div className="flex gap-6">
                        <div className="flex-1 min-w-0">
                          <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                            <input
                              type="radio"
                              name="validityUnit"
                              checked={formValidityUnit === "years"}
                              onChange={() => setFormValidityUnit("years")}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">Years</span>
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={formValidityYears}
                            onChange={(e) =>
                              setFormValidityYears(e.target.value)
                            }
                            disabled={formValidityUnit !== "years"}
                            placeholder="e.g. 1"
                            className={`w-full px-3 py-2 rounded border text-sm ${formValidityUnit !== "years" ? "opacity-50 cursor-not-allowed" : ""} ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                            <input
                              type="radio"
                              name="validityUnit"
                              checked={formValidityUnit === "months"}
                              onChange={() => setFormValidityUnit("months")}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">Months</span>
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={formValidityMonths}
                            onChange={(e) =>
                              setFormValidityMonths(e.target.value)
                            }
                            disabled={formValidityUnit !== "months"}
                            placeholder="e.g. 6"
                            className={`w-full px-3 py-2 rounded border text-sm ${formValidityUnit !== "months" ? "opacity-50 cursor-not-allowed" : ""} ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                            <input
                              type="radio"
                              name="validityUnit"
                              checked={formValidityUnit === "days"}
                              onChange={() => setFormValidityUnit("days")}
                              className="w-4 h-4"
                            />
                            <span className="text-sm">Days</span>
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={formValidityDays}
                            onChange={(e) =>
                              setFormValidityDays(e.target.value)
                            }
                            disabled={formValidityUnit !== "days"}
                            placeholder="e.g. 90"
                            className={`w-full px-3 py-2 rounded border text-sm ${formValidityUnit !== "days" ? "opacity-50 cursor-not-allowed" : ""} ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div
                className={`flex justify-end gap-2 px-8 py-5 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}
              >
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={requirementSaving}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${requirementSaving ? "opacity-60 cursor-not-allowed" : isDark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                >
                  <X className="w-5 h-5" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={requirementSaving}
                  className={`flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg transition-colors ${requirementSaving ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700"}`}
                >
                  {requirementSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Requirement 詳細モーダル（要件名クリックで開く） */}
        {detailModalReqId &&
          (() => {
            const req = statusRequirements.find(
              (r) => r.id === detailModalReqId,
            );
            const entry = (detailSelectedGroupKey != null
              ? detailEntryByGroup[detailSelectedGroupKey]
              : null) ??
              statusMapping[detailModalReqId] ?? {
                dueDate: null,
                payDate: null,
                billDate: null,
                validityDurationValue: null,
                validityDurationUnit: null,
                estimatedDueDate: null,
              };
            const cid = req?.companyId ?? selectedCompanyId;
            const companyName =
              (cid
                ? companies.find((c) => c.id === cid)?.company_name ??
                  adminCompanies.find((t) => t.id === cid)?.company_name
                : null) ?? "";
            const formatD = (s: string | null) =>
              s
                ? new Date(s + "T12:00:00").toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "—";
            const validityLabel =
              entry.validityDurationUnit && entry.validityDurationValue
                ? `${entry.validityDurationValue} ${entry.validityDurationUnit}`
                : "—";
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div
                  className={`rounded-xl shadow-xl w-full mx-4 overflow-hidden flex flex-col max-h-[90vh] ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}
                  style={{ maxWidth: "min(42rem, 92vw)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className={`px-6 py-4 border-b flex items-center justify-between shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <h3
                        className={`text-lg font-semibold truncate ${isDark ? "text-slate-100" : "text-gray-900"}`}
                      >
                        {req?.title ?? "Requirement"}
                      </h3>
                      {detailUploadMode && detailSelectedGroupKey != null && (
                        <span
                          className={`text-xs shrink-0 ${isDark ? "text-slate-300" : "text-gray-600"}`}
                        >
                          Bill date:{" "}
                          {formatDetailSidebarBillDate(
                            detailEntryByGroup[detailSelectedGroupKey],
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {detailUploadMode ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailUploadFile(null);
                              setDetailUploadMode(false);
                            }}
                            disabled={detailUploadSaving}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveDetailUpload}
                            disabled={detailUploadSaving || !detailUploadFile}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-60`}
                          >
                            <Save className="w-4 h-4" />
                            {detailUploadSaving ? "Saving..." : "Save"}
                          </button>
                        </>
                      ) : !detailModalEditMode ? null : (
                        <>
                          <button
                            type="button"
                            onClick={() => setDetailModalEditMode(false)}
                            disabled={savingDetail}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveDetailModal}
                            disabled={savingDetail}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-60`}
                          >
                            <Save className="w-4 h-4" />
                            {savingDetail ? "Saving..." : "Save"}
                          </button>
                        </>
                      )}
                      {!detailUploadMode && (
                        <button
                          type="button"
                          onClick={() => {
                            setDetailModalReqId(null);
                            setDetailModalEditMode(false);
                            setDetailUploadMode(false);
                            setDetailUploadFile(null);
                          }}
                          className={`p-2 rounded-lg transition-colors `}
                          title="Close"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 min-h-0">
                    {/* 左: グループ一覧（新しい順） */}
                    {!detailUploadMode && (
                      <div
                        className={`w-32 shrink-0 border-r overflow-y-auto ${isDark ? "border-slate-700 bg-slate-800/80" : "border-gray-200 bg-gray-50"}`}
                      >
                        <div
                          className={`px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-slate-400" : "text-gray-500"}`}
                        >
                          Bill date
                        </div>
                        {detailGroupKeys.length === 0 ? (
                          <div
                            className={`p-3 text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}
                          >
                            Loading...
                          </div>
                        ) : (
                          <ul className="p-2 space-y-0.5">
                            {detailGroupKeys.map((gk) => (
                              <li key={gk}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (detailUploadMode || detailModalEditMode)
                                      return;
                                    setDetailSelectedGroupKey(gk);
                                  }}
                                  disabled={detailUploadMode || detailModalEditMode}
                                  className={`w-full text-left px-2 py-2 rounded text-xs font-medium leading-snug transition-colors ${
                                    detailSelectedGroupKey === gk
                                      ? isDark
                                        ? "bg-slate-600 text-slate-100"
                                        : "bg-blue-100 text-blue-800"
                                      : isDark
                                        ? "text-slate-300 hover:bg-slate-700"
                                        : "text-gray-700 hover:bg-gray-200"
                                  } ${detailUploadMode || detailModalEditMode ? "opacity-60 cursor-not-allowed" : ""}`}
                                >
                                  {formatDetailSidebarBillDate(
                                    detailEntryByGroup[gk],
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {/* 右: 選択中 group の詳細 / Upload モード */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-3 text-sm">
                      {!detailUploadMode && (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 flex-1">
                              <span
                                className={
                                  isDark ? "text-slate-400" : "text-gray-500"
                                }
                              >
                                Company:
                              </span>{" "}
                              <span className="inline-block max-w-full truncate align-middle">{companyName || "—"}</span>
                            </p>
                            {!detailModalEditMode && (
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={openDetailEditMode}
                                  disabled={savingDetail || detailSelectedGroupKey == null}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-700 hover:bg-gray-300"} ${detailSelectedGroupKey == null ? "opacity-60 cursor-not-allowed" : ""}`}
                                >
                                  <Edit className="w-4 h-4" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (detailSelectedGroupKey == null) return;
                                    setDetailUploadMode(true);
                                  }}
                                  disabled={detailSelectedGroupKey == null}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isDark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"} ${detailSelectedGroupKey == null ? "opacity-60 cursor-not-allowed" : ""}`}
                                >
                                  <UploadCloud className="w-4 h-4" />
                                  Upload
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                      {!detailUploadMode && !detailModalEditMode ? (
                        <>
                          <p>
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-500"
                              }
                            >
                              Due date:
                            </span>{" "}
                            {formatD(entry.dueDate)}
                          </p>
                          <p>
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-500"
                              }
                            >
                              Bill date:
                            </span>{" "}
                            {formatD(entry.billDate)}
                          </p>
                          <p>
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-500"
                              }
                            >
                              Pay date:
                            </span>{" "}
                            {entry.payDate
                              ? formatD(entry.payDate)
                              : "Not paid yet"}
                          </p>
                          <p>
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-500"
                              }
                            >
                              Validity duration:
                            </span>{" "}
                            {validityLabel}
                          </p>
                          <p>
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-500"
                              }
                            >
                              Estimated due date:
                            </span>{" "}
                            {formatD(entry.estimatedDueDate)}
                          </p>
                          <p>
                            <span
                              className={
                                isDark ? "text-slate-400" : "text-gray-500"
                              }
                            >
                              Documents:
                            </span>{" "}
                            {detailDocumentsLoading ? (
                              <span
                                className={
                                  isDark ? "text-slate-500" : "text-gray-500"
                                }
                              >
                                Loading...
                              </span>
                            ) : detailDocuments.length === 0 ? (
                              <span
                                className={
                                  isDark ? "text-slate-500" : "text-gray-500"
                                }
                              >
                                None
                              </span>
                            ) : (
                              <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
                                {detailDocuments.map((doc) => {
                                  const label =
                                    doc.file_name ||
                                    doc.key.split("/").pop() ||
                                    "Document";
                                  return (
                                    <button
                                      key={doc.key}
                                      type="button"
                                      onClick={() => {
                                        openPresignedDocumentInNewTab(() =>
                                          companyRequirementRealDataAPI.getDocumentUrl(
                                            doc.key,
                                          ),
                                        );
                                      }}
                                      className={`text-blue-600 hover:underline dark:text-blue-400 ${isDark ? "hover:text-blue-300" : "hover:text-blue-700"}`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </span>
                            )}
                          </p>
                        </>
                      ) : !detailUploadMode && detailModalEditMode ? (
                        <div className="space-y-4">
                          <div>
                            <label
                              className={`block font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              Due date
                            </label>
                            <input
                              type="date"
                              value={detailEditDueDate}
                              onChange={(e) =>
                                setDetailEditDueDate(e.target.value)
                              }
                              className={`w-full px-3 py-2 rounded border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                            />
                          </div>
                          <div>
                            <label
                              className={`block font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              Bill date
                            </label>
                            <input
                              type="date"
                              value={detailEditBillDate}
                              onChange={(e) =>
                                setDetailEditBillDate(e.target.value)
                              }
                              className={`w-full px-3 py-2 rounded border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                            />
                          </div>
                          <div>
                            <label
                              className={`block font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              Pay date
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer mb-1">
                              <input
                                type="radio"
                                checked={detailEditPayNotPaid}
                                onChange={() => {
                                  setDetailEditPayNotPaid(true);
                                  setDetailEditPayDate("");
                                }}
                                className="w-4 h-4"
                              />
                              <span>Not paid yet</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer mb-1">
                              <input
                                type="radio"
                                checked={!detailEditPayNotPaid}
                                onChange={() => setDetailEditPayNotPaid(false)}
                                className="w-4 h-4"
                              />
                              <span>Paid</span>
                            </label>
                            {!detailEditPayNotPaid && (
                              <input
                                type="date"
                                value={detailEditPayDate}
                                onChange={(e) =>
                                  setDetailEditPayDate(e.target.value)
                                }
                                className={`w-full px-3 py-2 rounded border text-sm mt-1 ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                              />
                            )}
                          </div>
                          <div>
                            <label
                              className={`block font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              Validity duration
                            </label>
                            <div className="flex flex-wrap items-center gap-3">
                              {(["years", "months", "days"] as const).map(
                                (u) => (
                                  <label
                                    key={u}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <input
                                      type="radio"
                                      checked={detailEditValidityUnit === u}
                                      onChange={() =>
                                        setDetailEditValidityUnit(u)
                                      }
                                      className="w-4 h-4"
                                    />
                                    <span className="capitalize">{u}</span>
                                    <input
                                      type="number"
                                      min={1}
                                      value={detailEditValidityValue}
                                      onChange={(e) =>
                                        setDetailEditValidityValue(
                                          e.target.value,
                                        )
                                      }
                                      disabled={detailEditValidityUnit !== u}
                                      className={`w-16 px-2 py-1 rounded border text-sm ${detailEditValidityUnit !== u ? "opacity-50" : ""} ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                                    />
                                  </label>
                                ),
                              )}
                            </div>
                          </div>
                          <div>
                            <label
                              className={`block font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              Estimated due date
                            </label>
                            <input
                              type="date"
                              value={detailEditEstimatedDueDate}
                              onChange={(e) =>
                                setDetailEditEstimatedDueDate(e.target.value)
                              }
                              className={`w-full px-3 py-2 rounded border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                            />
                          </div>
                          {/* この group のドキュメント一覧（Edit 中は Remove を一時フラグにして Save で確定削除） */}
                          <div>
                            <span
                              className={`block font-medium mb-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              Documents for this period
                            </span>
                            {detailDocumentsLoading ? (
                              <p
                                className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}
                              >
                                Loading...
                              </p>
                            ) : detailDocuments.length === 0 ? (
                              <p
                                className={`text-sm ${isDark ? "text-slate-500" : "text-gray-500"}`}
                              >
                                No documents.
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {detailDocuments
                                  .filter(
                                    (doc) =>
                                      !detailPendingDeleteKeys.includes(
                                        doc.key,
                                      ),
                                  )
                                  .map((doc) => {
                                    const label =
                                      doc.file_name ||
                                      doc.key.split("/").pop() ||
                                      "Document";
                                    return (
                                      <li
                                        key={doc.key}
                                        className="flex items-center gap-2"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            openPresignedDocumentInNewTab(
                                              () =>
                                                companyRequirementRealDataAPI.getDocumentUrl(
                                                  doc.key,
                                                ),
                                            );
                                          }}
                                          className={`text-sm text-blue-600 hover:underline dark:text-blue-400 ${isDark ? "hover:text-blue-300" : "hover:text-blue-700"}`}
                                        >
                                          {label}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (
                                              !confirm(
                                                "Remove this document? It will be deleted when you save.",
                                              )
                                            )
                                              return;
                                            setDetailPendingDeleteKeys(
                                              (prev) =>
                                                prev.includes(doc.key)
                                                  ? prev
                                                  : [...prev, doc.key],
                                            );
                                          }}
                                          className={`text-xs px-2 py-1 rounded ${isDark ? "text-slate-400 hover:bg-slate-600" : "text-gray-500 hover:bg-gray-200"}`}
                                        >
                                          Remove
                                        </button>
                                      </li>
                                    );
                                  })}
                              </ul>
                            )}
                          </div>
                        </div>
                      ) : null}
                      {detailUploadMode && detailSelectedGroupKey != null && (
                        <div
                          className={`mt-4 p-4 rounded-lg border space-y-3 ${
                            isDark
                              ? "border-slate-700 bg-slate-800/70"
                              : "border-gray-200 bg-gray-50"
                          }`}
                        >
                          <div
                            className={`font-medium ${
                              isDark ? "text-slate-200" : "text-gray-800"
                            }`}
                          >
                            Upload
                          </div>
                          {!detailUploadFile ? (
                            <label
                              className={`flex flex-col items-center justify-center gap-2 w-full py-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                                isDark
                                  ? "border-slate-600 hover:border-slate-500 hover:bg-slate-700/50"
                                  : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
                              }`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const file = e.dataTransfer.files?.[0];
                                if (file) setDetailUploadFile(file);
                              }}
                            >
                              <UploadCloud
                                className={`w-8 h-8 ${
                                  isDark ? "text-slate-400" : "text-gray-400"
                                }`}
                              />
                              <span
                                className={`text-sm ${
                                  isDark ? "text-slate-400" : "text-gray-500"
                                }`}
                              >
                                Drop file or click to select
                              </span>
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg,image/jpg"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) setDetailUploadFile(f);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          ) : (
                            <div
                              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                                isDark
                                  ? "bg-slate-700 border-slate-600"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span
                                className={`text-sm truncate ${
                                  isDark ? "text-slate-200" : "text-gray-700"
                                }`}
                              >
                                {detailUploadFile.name}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (typeof window === "undefined") return;
                                    const url = URL.createObjectURL(
                                      detailUploadFile,
                                    );
                                    const w = window.open(url, "_blank");
                                    if (w == null) {
                                      URL.revokeObjectURL(url);
                                    }
                                  }}
                                  className={`text-sm px-2 py-1 rounded ${
                                    isDark
                                      ? "text-slate-300 hover:bg-slate-600"
                                      : "text-gray-600 hover:bg-gray-200"
                                  }`}
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDetailUploadFile(null)}
                                  className={`text-sm px-2 py-1 rounded ${
                                    isDark
                                      ? "text-slate-300 hover:bg-slate-600"
                                      : "text-gray-600 hover:bg-gray-200"
                                  }`}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        {/* Record Payment モーダル */}
        {recordPaymentModalReqId &&
          (() => {
            const req = statusRequirements.find(
              (r) => r.id === recordPaymentModalReqId,
            );
            const entry = statusMapping[recordPaymentModalReqId] ?? {
              dueDate: null,
              payDate: null,
              billDate: null,
              validityDurationValue: null,
              validityDurationUnit: null,
              estimatedDueDate: null,
              estimatedSpecificBillDate: null,
              estimatedBillDateValidityBased: null,
            };
            const computedDueValidity =
              entry.dueDate &&
              entry.validityDurationValue &&
              entry.validityDurationUnit
                ? (() => {
                    const n = parseInt(entry.validityDurationValue, 10);
                    if (!Number.isInteger(n) || n <= 0) return null;
                    if (entry.validityDurationUnit === "years")
                      return addYears(entry.dueDate, n);
                    if (entry.validityDurationUnit === "months")
                      return addMonths(entry.dueDate, n);
                    return addDays(entry.dueDate, n);
                  })()
                : null;
            const computedBillValidity =
              entry.billDate &&
              entry.validityDurationValue &&
              entry.validityDurationUnit
                ? (() => {
                    const n = parseInt(entry.validityDurationValue, 10);
                    if (!Number.isInteger(n) || n <= 0) return null;
                    if (entry.validityDurationUnit === "years")
                      return addYears(entry.billDate, n);
                    if (entry.validityDurationUnit === "months")
                      return addMonths(entry.billDate, n);
                    return addDays(entry.billDate, n);
                  })()
                : null;
            const validityLabel =
              entry.validityDurationUnit && entry.validityDurationValue
                ? `${entry.validityDurationValue} ${entry.validityDurationUnit}`
                : "";
            return (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
                <div
                  className={`rounded-xl shadow-xl w-full mx-4 max-h-[90vh] overflow-y-auto ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}
                  style={{ maxWidth: "min(28rem, 90vw)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className={`px-6 py-4 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}
                  >
                    <h3
                      className={`text-lg font-semibold ${isDark ? "text-slate-100" : "text-gray-900"}`}
                    >
                      Record Payment
                    </h3>
                    <p
                      className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}
                    >
                      {req?.title}
                    </p>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <label
                        className={`block text-sm font-medium mb-1 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Payment made date
                      </label>
                      <input
                        type="date"
                        value={recordPaymentPaymentMadeDate}
                        onChange={(e) =>
                          setRecordPaymentPaymentMadeDate(e.target.value)
                        }
                        className={`w-full px-4 py-2 rounded-lg border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                      />
                    </div>
                    <div>
                      <label
                        className={`block text-sm font-medium mb-2 ${isDark ? "text-slate-300" : "text-gray-700"}`}
                      >
                        Upload
                      </label>
                      <input
                        id="record-payment-upload"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg,image/jpg"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const ext = file.name
                              .split(".")
                              .pop()
                              ?.toLowerCase();
                            const allowed = ["pdf", "jpg", "jpeg"];
                            if (ext && allowed.includes(ext)) {
                              setRecordPaymentUploadFile(file);
                            } else {
                              setRecordPaymentUploadFile(null);
                              e.target.value = "";
                            }
                          } else {
                            setRecordPaymentUploadFile(null);
                          }
                        }}
                        className="sr-only"
                      />
                      <label
                        htmlFor="record-payment-upload"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const file = e.dataTransfer.files?.[0];
                          if (file) {
                            const ext = file.name
                              .split(".")
                              .pop()
                              ?.toLowerCase();
                            const allowed = ["pdf", "jpg", "jpeg"];
                            if (ext && allowed.includes(ext)) {
                              setRecordPaymentUploadFile(file);
                            }
                          }
                        }}
                        className={`flex flex-col items-center justify-center gap-2 min-h-[100px] w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors ${recordPaymentUploadFile ? (isDark ? "bg-slate-700/50 border-slate-500" : "bg-gray-50 border-gray-300") : isDark ? "bg-slate-700/30 border-slate-600 hover:border-slate-500 hover:bg-slate-700/50" : "bg-gray-50/80 border-gray-300 hover:border-gray-400 hover:bg-gray-100"}`}
                      >
                        {recordPaymentUploadFile ? (
                          <>
                            <div
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isDark ? "bg-slate-600" : "bg-white shadow-sm border border-gray-200"}`}
                            >
                              {recordPaymentUploadFile.type.startsWith(
                                "image/",
                              ) ? (
                                <ImageIcon
                                  className="w-4 h-4 shrink-0 text-emerald-500"
                                  aria-hidden
                                />
                              ) : (
                                <FileText className="w-4 h-4 shrink-0 text-amber-500" />
                              )}
                              <span
                                className={`text-sm font-medium truncate max-w-[200px] ${isDark ? "text-slate-200" : "text-gray-800"}`}
                                title={recordPaymentUploadFile.name}
                              >
                                {recordPaymentUploadFile.name}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (typeof window === "undefined") return;
                                    const url = URL.createObjectURL(
                                      recordPaymentUploadFile,
                                    );
                                    const w = window.open(url, "_blank");
                                    if (w == null) {
                                      URL.revokeObjectURL(url);
                                    }
                                  }}
                                  className={`px-2 py-0.5 text-xs rounded ${isDark ? "text-slate-200 hover:bg-slate-500" : "text-gray-700 hover:bg-gray-100"}`}
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setRecordPaymentUploadFile(null);
                                    const el = document.getElementById(
                                      "record-payment-upload",
                                    ) as HTMLInputElement;
                                    if (el) el.value = "";
                                  }}
                                  className={`p-0.5 rounded hover:opacity-80 ${isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700"}`}
                                  aria-label="Remove file"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <span
                              className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}
                            >
                              Click or drop to replace
                            </span>
                          </>
                        ) : (
                          <>
                            <UploadCloud
                              className={`w-8 h-8 shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`}
                            />
                            <span
                              className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}
                            >
                              Choose file or drag here
                            </span>
                            <span
                              className={`text-xs ${isDark ? "text-slate-500" : "text-gray-500"}`}
                            >
                              PDF, JPG only.
                            </span>
                          </>
                        )}
                      </label>
                    </div>
                    <div
                      className={`border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}
                    />
                    <div>
                      <button
                        type="button"
                        className={`w-full flex items-center justify-between text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}
                        onClick={() =>
                          setRecordPaymentDueAccordionOpen((o) => !o)
                        }
                      >
                        Next estimated due date
                        <span className="text-xs">
                          {recordPaymentDueAccordionOpen ? "▼" : "▶"}
                        </span>
                      </button>
                      {recordPaymentDueAccordionOpen && (
                        <div className="mt-2 pl-2 space-y-2 border-l-2 border-slate-400">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="recordDue"
                              checked={!recordPaymentDueValidityBased}
                              onChange={() =>
                                setRecordPaymentDueValidityBased(false)
                              }
                              className="w-4 h-4"
                            />
                            <span>Specific</span>
                          </label>
                          {!recordPaymentDueValidityBased && (
                            <input
                              type="date"
                              value={recordPaymentDueSpecific}
                              onChange={(e) =>
                                setRecordPaymentDueSpecific(e.target.value)
                              }
                              className={`w-full px-3 py-1.5 rounded border text-sm ml-6 ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                            />
                          )}
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="recordDue"
                              checked={recordPaymentDueValidityBased}
                              onChange={() =>
                                setRecordPaymentDueValidityBased(true)
                              }
                              className="w-4 h-4"
                            />
                            <span>Based on validity duration</span>
                          </label>
                          {recordPaymentDueValidityBased && (
                            <div
                              className={`ml-6 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              {validityLabel && (
                                <span className="opacity-70">
                                  Validity: {validityLabel}.{" "}
                                </span>
                              )}
                              {computedDueValidity
                                ? `Result: ${new Date(computedDueValidity + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
                                : "—"}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <button
                        type="button"
                        className={`w-full flex items-center justify-between text-left text-sm font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}
                        onClick={() =>
                          setRecordPaymentBillAccordionOpen((o) => !o)
                        }
                      >
                        Next estimated bill date
                        <span className="text-xs">
                          {recordPaymentBillAccordionOpen ? "▼" : "▶"}
                        </span>
                      </button>
                      {recordPaymentBillAccordionOpen && (
                        <div className="mt-2 pl-2 space-y-2 border-l-2 border-slate-400">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="recordBill"
                              checked={!recordPaymentBillValidityBased}
                              onChange={() =>
                                setRecordPaymentBillValidityBased(false)
                              }
                              className="w-4 h-4"
                            />
                            <span>Specific</span>
                          </label>
                          {!recordPaymentBillValidityBased && (
                            <input
                              type="date"
                              value={recordPaymentBillSpecific}
                              onChange={(e) =>
                                setRecordPaymentBillSpecific(e.target.value)
                              }
                              className={`w-full px-3 py-1.5 rounded border text-sm ml-6 ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-gray-300 text-gray-700"}`}
                            />
                          )}
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="recordBill"
                              checked={recordPaymentBillValidityBased}
                              onChange={() =>
                                setRecordPaymentBillValidityBased(true)
                              }
                              className="w-4 h-4"
                            />
                            <span>Based on validity duration</span>
                          </label>
                          {recordPaymentBillValidityBased && (
                            <div
                              className={`ml-6 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}
                            >
                              {validityLabel && (
                                <span className="opacity-70">
                                  Validity: {validityLabel}.{" "}
                                </span>
                              )}
                              {computedBillValidity
                                ? `Result: ${new Date(computedBillValidity + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
                                : "—"}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    className={`flex justify-end gap-2 px-6 py-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleCancelRecordPayment();
                        setRecordPaymentModalReqId(null);
                      }}
                      disabled={savingRecordPayment}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${savingRecordPayment ? "opacity-60 cursor-not-allowed" : isDark ? "bg-slate-600 text-slate-200 hover:bg-slate-500" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleSaveRecordPayment();
                        setRecordPaymentModalReqId(null);
                      }}
                      disabled={savingRecordPayment}
                      className={`flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg transition-colors ${savingRecordPayment ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700"}`}
                    >
                      {savingRecordPayment ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
