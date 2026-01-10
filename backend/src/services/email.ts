import { Resend } from "resend";
import { render } from "@react-email/render";
import { InvitationEmail } from "../emails/invitation-email";
import * as React from "react";

// Resendクライアントを遅延初期化（関数内で初期化）
function getResendClient(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  return new Resend(process.env.RESEND_API_KEY);
}

export interface InvitationEmailParams {
  to: string;
  tenantName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

/**
 * 招待メールを送信
 * @returns email_id (Resendが返すメール送信の一意ID)
 */
export async function sendInvitationEmail(
  params: InvitationEmailParams
): Promise<string> {
  const { to, tenantName, inviterName, role, acceptUrl } = params;

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  // Resendクライアントを取得（毎回初期化して環境変数の変更に対応）
  const resend = getResendClient();

  try {
    // React EmailコンポーネントをHTML文字列に変換
    const html = await render(
      React.createElement(InvitationEmail, {
        tenantName,
        inviterName,
        role,
        acceptUrl,
      })
    );

    const { data, error } = await resend.emails.send({
      from:
        process.env.RESEND_FROM_EMAIL || "Food Costing <onboarding@resend.dev>",
      to: [to],
      subject: `You've been invited to join ${tenantName} on Food Costing`,
      html,
    });

    if (error) {
      console.error("[Email Service] Error sending invitation email:", error);
      throw error;
    }

    if (!data || !data.id) {
      throw new Error("Resend did not return an email_id");
    }

    console.log("[Email Service] Invitation email sent successfully:", data);
    return data.id; // email_idを返す
  } catch (error) {
    console.error("[Email Service] Failed to send invitation email:", error);
    throw error;
  }
}
