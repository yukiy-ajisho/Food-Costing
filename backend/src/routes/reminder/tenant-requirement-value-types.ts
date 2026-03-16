import { Router } from "express";
import { supabase } from "../../config/supabase";

const router = Router();

/**
 * GET /tenant-requirement-value-types
 * 値の種類マスタ一覧（Due date, Bill date, Pay date, Validity duration）
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("tenant_requirement_value_types")
      .select("id, name, data_type")
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
