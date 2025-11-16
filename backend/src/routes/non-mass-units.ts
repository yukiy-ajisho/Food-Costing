import { Router } from "express";
import { NON_MASS_UNITS } from "../constants/units";

const router = Router();

/**
 * GET /non-mass-units
 * 全非質量単位を取得（ハードコードされたデータを返す）
 */
router.get("/", async (req, res) => {
  try {
    // ハードコードされた非質量単位を返す
    const nonMassUnits = NON_MASS_UNITS.map((name, index) => ({
      id: `hardcoded-${index}`,
      name: name,
    }));

    res.json(nonMassUnits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
