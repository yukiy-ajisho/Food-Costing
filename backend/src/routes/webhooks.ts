import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import crypto from "crypto";

const router = Router();

/**
 * POST /webhooks/resend
 * ResendからのWebhookを受信してemail_statusを更新
 * 認証: 不要（Resendからの直接アクセス）
 * セキュリティ: 署名検証を実装
 */
router.post("/resend", async (req: Request, res: Response) => {
  try {
    // Svixの署名検証（ResendはSvixを使用してWebhookを送信）
    const svixSignature = req.headers["svix-signature"] as string | undefined;
    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    // 生のボディを取得（express.raw()ミドルウェアによりBufferとして取得）
    const rawBody = req.body as Buffer;
    const bodyString = rawBody.toString("utf-8");

    // 署名検証（Svixの方法）
    if (webhookSecret && svixSignature && svixId && svixTimestamp) {
      const isValid = verifySvixSignature(
        bodyString,
        svixSignature,
        svixId,
        svixTimestamp,
        webhookSecret
      );

      if (!isValid) {
        console.error("[Webhook] Invalid signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
      console.log("[Webhook] Signature verified successfully");
    } else if (webhookSecret && (!svixSignature || !svixId || !svixTimestamp)) {
      // シークレットが設定されているが署名情報が不足している場合は警告
      console.warn(
        "[Webhook] Webhook secret is set but signature information is incomplete:",
        {
          hasSignature: !!svixSignature,
          hasId: !!svixId,
          hasTimestamp: !!svixTimestamp,
        }
      );
    }

    // JSONパース（署名検証後にパース）
    const event = JSON.parse(bodyString);

    // イベントタイプを確認
    if (!event.type || !event.data) {
      console.error("[Webhook] Invalid event format:", event);
      return res.status(400).json({ error: "Invalid event format" });
    }

    // email_idを取得（ベストプラクティス: email_idで正確に特定）
    const emailId = event.data.email_id;
    if (!emailId) {
      console.error("[Webhook] No email_id in event:", event);
      return res.status(400).json({ error: "No email_id in event" });
    }

    // emailアドレスを取得（ログ用）
    const email = Array.isArray(event.data.to)
      ? event.data.to[0]
      : event.data.to || event.data.email;

    // イベントタイプに応じてemail_statusを更新
    let emailStatus: "delivered" | "failed" | null = null;

    switch (event.type) {
      case "email.sent":
      case "email.delivered":
        emailStatus = "delivered";
        break;
      case "email.bounced":
      case "email.complained":
      case "email.failed":
        emailStatus = "failed";
        break;
      case "email.delivery_delayed":
        // 無視（最終結果を待つ）
        return res.status(200).json({ message: "Event ignored" });
      default:
        // その他のイベント（clicked, opened, received, scheduled）は無視
        return res.status(200).json({ message: "Event ignored" });
    }

    // email_idを使って該当するinvitationsレコードを更新
    // email_idは一意なので、確実に1つのinvitationを特定できる
    const { data: updatedInvitation, error: updateError } = await supabase
      .from("invitations")
      .update({ email_status: emailStatus })
      .eq("email_id", emailId)
      .eq("status", "pending") // pendingの招待のみ更新
      .select()
      .single();

    if (updateError) {
      // email_idが見つからない場合（古いデータや手動で削除された場合など）
      if (updateError.code === "PGRST116") {
        console.warn(`[Webhook] No invitation found with email_id: ${emailId}`);
        return res.status(200).json({
          message:
            "Invitation not found (may have been deleted or already processed)",
        });
      }

      console.error("[Webhook] Error updating invitation:", updateError);
      return res.status(500).json({
        error: "Failed to update invitation",
        details: updateError.message,
      });
    }

    console.log(
      `[Webhook] Updated invitation email_status to ${emailStatus} for email_id: ${emailId} (email: ${email}, invitation_id: ${updatedInvitation?.id})`
    );

    res.status(200).json({ message: "Webhook processed successfully" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Webhook] Unexpected error:", error);
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

/**
 * SvixのWebhook署名検証
 * ResendはSvixを使用してWebhookを送信しているため、Svixの署名検証方法を使用
 *
 * Svixの署名形式: v1,<signature> (複数の署名が含まれる可能性がある)
 * 署名の計算: HMAC-SHA256(svix-id + svix-timestamp + payload, secret)
 * 署名の形式: Base64エンコード
 */
function verifySvixSignature(
  payload: string,
  svixSignature: string,
  svixId: string,
  svixTimestamp: string,
  secret: string
): boolean {
  try {
    // Svixのシークレットキーの処理
    // whsec_ の後の部分をBase64デコードして使用
    let cleanSecret: string | Buffer;
    if (secret.startsWith("whsec_")) {
      // whsec_ の後の部分をBase64デコード
      const base64Part = secret.substring(6);
      cleanSecret = Buffer.from(base64Part, "base64");
    } else {
      cleanSecret = secret;
    }

    // Svixの署名形式: v1,<signature> (複数の署名が含まれる可能性がある)
    // 各署名を検証（リプレイ攻撃対策のため複数の署名が含まれる場合がある）
    const signatures = svixSignature.split(" ");

    // 署名を計算: svix-id + svix-timestamp + payload
    const signedContent = `${svixId}.${svixTimestamp}.${payload}`;

    const expectedSignature = crypto
      .createHmac("sha256", cleanSecret)
      .update(signedContent)
      .digest("base64");

    // 各署名を検証
    for (const signature of signatures) {
      // 署名形式: v1,<signature>
      if (!signature.startsWith("v1,")) {
        continue;
      }

      const receivedSignature = signature.substring(3); // "v1," を除去

      // タイミング攻撃対策: crypto.timingSafeEqualを使用
      if (receivedSignature.length !== expectedSignature.length) {
        continue;
      }

      const signatureBuffer = Buffer.from(receivedSignature, "base64");
      const expectedBuffer = Buffer.from(expectedSignature, "base64");

      if (crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return true; // いずれかの署名が一致すれば有効
      }
    }
    return false; // すべての署名が一致しなかった
  } catch (error) {
    console.error("[Webhook] Signature verification error:", error);
    return false;
  }
}

export default router;
