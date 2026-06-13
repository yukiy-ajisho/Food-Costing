import { Router } from "express";
import { runInvoicingHourlyJob } from "../services/invoicing-cron";

const router = Router();

function verifyCronSecret(authHeader: string | undefined): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return false;
  }
  const expected = `Bearer ${secret}`;
  return authHeader === expected;
}

/**
 * POST /internal/cron/invoicing-hourly
 * Triggered by pg_cron + pg_net (§14-9). Not user-authenticated.
 */
router.post("/invoicing-hourly", async (req, res) => {
  if (!verifyCronSecret(req.headers.authorization)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runInvoicingHourlyJob();
    const status = result.ok ? 200 : 500;
    return res.status(status).json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[invoicing-cron] Job failed:", message);
    return res.status(500).json({ error: message });
  }
});

export default router;
