import { Router } from "express";
import { NON_MASS_UNITS } from "../constants/units";
import { UnifiedTenantAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import { getUnifiedTenantResource } from "../middleware/unified-resource-helpers";

const router = Router();

/**
 * GET /non-mass-units
 * 全非質量単位を取得（ハードコードされたデータを返す）
 */
router.get(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      // ハードコードされた非質量単位を返す
      const nonMassUnits = NON_MASS_UNITS.map((name, index) => ({
        id: `hardcoded-${index}`,
        name: name,
      }));

      res.json(nonMassUnits);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /non-mass-units
 * 非質量単位を作成（ハードコードされているため、作成不可）
 */
router.post("/", async (req, res) => {
  res.status(405).json({
    error: "Non-mass units are hardcoded and cannot be created",
  });
});

/**
 * DELETE /non-mass-units/:id
 * 非質量単位を削除（ハードコードされているため、削除不可）
 */
router.delete("/:id", async (req, res) => {
  res.status(405).json({
    error: "Non-mass units are hardcoded and cannot be deleted",
  });
});

export default router;
