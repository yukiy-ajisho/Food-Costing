import { Router } from "express";
import { supabase } from "../config/supabase";
import { ProceedValidationSettings } from "../types/database";

const router = Router();

/**
 * GET /proceed-validation-settings
 * ユーザーのProceed Validation Settingsを取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("proceed_validation_settings")
      .select("*")
      .eq("user_id", req.user!.id)
      .single();

    if (error) {
      // レコードが存在しない場合はデフォルト値を返す
      if (error.code === "PGRST116") {
        return res.json({
          id: "",
          user_id: req.user!.id,
          validation_mode: "block",
        });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /proceed-validation-settings
 * Proceed Validation Settingsを更新（存在しない場合は作成）
 */
router.put("/", async (req, res) => {
  try {
    const settings: Partial<ProceedValidationSettings> = req.body;

    // バリデーション
    if (
      settings.validation_mode &&
      !["permit", "block", "notify"].includes(settings.validation_mode)
    ) {
      return res.status(400).json({
        error: "validation_mode must be one of: permit, block, notify",
      });
    }

    // 既存のレコードを確認
    const { data: existingData } = await supabase
      .from("proceed_validation_settings")
      .select("*")
      .eq("user_id", req.user!.id)
      .single();

    if (existingData) {
      // 更新
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { user_id: _user_id, id: _id, ...settingsWithoutUserId } = settings;
      const { data, error } = await supabase
        .from("proceed_validation_settings")
        .update(settingsWithoutUserId)
        .eq("user_id", req.user!.id)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json(data);
    } else {
      // 作成
      const settingsWithUserId = {
        ...settings,
        user_id: req.user!.id,
        validation_mode: settings.validation_mode || "block",
      };

      const { data, error } = await supabase
        .from("proceed_validation_settings")
        .insert([settingsWithUserId])
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json(data);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
