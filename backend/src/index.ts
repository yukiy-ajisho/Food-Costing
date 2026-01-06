// 環境変数を最初に読み込む（インポートより前）
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();

import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
import { initializeAuthorizer } from "./authz/authorize";
import itemsRouter from "./routes/items";
import recipeLinesRouter from "./routes/recipe-lines";
import recipeLinesItemsRouter from "./routes/recipe-lines-items";
import costRouter from "./routes/cost";
import baseItemsRouter from "./routes/base-items";
import vendorsRouter from "./routes/vendors";
import vendorProductsRouter from "./routes/vendor-products";
import laborRolesRouter from "./routes/labor-roles";
import nonMassUnitsRouter from "./routes/non-mass-units";
import itemUnitProfilesRouter from "./routes/item-unit-profiles";
import proceedValidationSettingsRouter from "./routes/proceed-validation-settings";
import tenantsRouter from "./routes/tenants";
import productMappingsRouter from "./routes/product-mappings";
import resourceSharesRouter from "./routes/resource-shares";
import inviteRouter from "./routes/invite";
import webhooksRouter from "./routes/webhooks";
import accessRequestsRouter from "./routes/access-requests";

// Cedar Authorizerを初期化（Phase 2）- ルート登録の前に実行
try {
  initializeAuthorizer();
} catch (error) {
  console.error("Failed to initialize Cedar Authorizer:", error);
  // 認可エンジンの初期化失敗は致命的なので、サーバーを起動しない
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

// CORS設定（本番環境ではVercelのドメインを許可）
const corsOptions = {
  origin: process.env.FRONTEND_URL || "*", // 本番環境ではVercelのURLを設定
  credentials: true,
};

// ミドルウェア
app.use(cors(corsOptions));

// Webhookエンドポイント専用: 生のボディを取得（署名検証のため）
// 注意: express.json()より前に配置する必要がある（順序が重要）
app.use("/webhooks", express.raw({ type: "application/json" }));

// 一般的なJSONボディパーサー（/webhooks以外のすべてのリクエストに適用）
app.use(express.json());

// ルート
// ヘルスチェックエンドポイント（認証不要）
app.get("/", (req, res) => {
  res.json({ message: "Food Costing API is running" });
});

// ============================================
// 認証不要のルート（最初に配置）
// ============================================
// Webhook routes: 認証不要（Resendからの直接アクセス）
app.use("/webhooks", webhooksRouter);
// Invite routes: /invite/verify/:token is public, others require auth
app.use("/invite", inviteRouter);
// Access requests: POST is public, others require System Admin
app.use("/access-requests", accessRequestsRouter);

// ============================================
// 認証が必要なルート（特定のパスを先に配置）
// ============================================
app.use("/items", authMiddleware(), itemsRouter);
app.use("/recipe-lines", authMiddleware(), recipeLinesRouter);
app.use("/base-items", authMiddleware(), baseItemsRouter);
app.use("/vendors", authMiddleware(), vendorsRouter);
app.use("/vendor-products", authMiddleware(), vendorProductsRouter);
app.use("/labor-roles", authMiddleware(), laborRolesRouter);
app.use("/non-mass-units", authMiddleware(), nonMassUnitsRouter);
app.use("/item-unit-profiles", authMiddleware(), itemUnitProfilesRouter);
app.use(
  "/proceed-validation-settings",
  authMiddleware(),
  proceedValidationSettingsRouter
);
app.use("/tenants", tenantsRouter);
app.use("/product-mappings", authMiddleware(), productMappingsRouter);
app.use("/resource-shares", authMiddleware(), resourceSharesRouter);

// ============================================
// 認証が必要なルート（汎用パス - 最後に配置）
// ============================================
// recipeLinesItemsRouter: /items/:id/recipe, /items/recipes を処理
app.use("/", authMiddleware(), recipeLinesItemsRouter);
// costRouter: /items/:id/cost, /items/costs などを処理
app.use("/", authMiddleware(), costRouter);

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
