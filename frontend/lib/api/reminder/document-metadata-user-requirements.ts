/**
 * Employee requirement documents (document_metadata_user_requirements + R2)
 */

import { apiRequest } from "@/lib/api";

export interface EmployeeRequirementDocumentRow {
  id: string;
  value: string;
  file_name: string;
  content_type?: string | null;
  size_bytes?: number | null;
  created_at?: string;
}

export const documentMetadataUserRequirementsAPI = {
  getDocuments: (mappingUserRequirementId: string) =>
    apiRequest<EmployeeRequirementDocumentRow[]>(
      `/document-metadata-user-requirements/documents?mapping_user_requirement_id=${encodeURIComponent(mappingUserRequirementId)}`
    ),

  getDocumentUrl: (key: string) =>
    apiRequest<{ url: string }>(
      `/document-metadata-user-requirements/document-url?key=${encodeURIComponent(key)}`
    ),

  uploadDocument: (mappingUserRequirementId: string, file: File) => {
    const form = new FormData();
    form.append("mapping_user_requirement_id", mappingUserRequirementId);
    form.append("file", file);
    return apiRequest<{ ok: boolean; id: string }>(
      "/document-metadata-user-requirements/document",
      { method: "POST", body: form }
    );
  },

  deleteDocument: (id: string) =>
    apiRequest<{ ok: boolean }>(
      `/document-metadata-user-requirements/document?id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),
};
