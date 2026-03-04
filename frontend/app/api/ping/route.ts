import { NextResponse } from "next/server";

/**
 * 認証不要のヘルスチェック用エンドポイント。
 * cron や UptimeRobot などで Vercel のコールドスタート防止用に叩くことを想定。
 */
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() }, { status: 200 });
}
