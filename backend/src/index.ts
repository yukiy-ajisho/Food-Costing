// 環境変数を最初に読み込む（インポートより前）
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();

import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth";
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

const app = express();
const PORT = process.env.PORT || 4000;

// CORS設定（本番環境ではVercelのドメインを許可）
const corsOptions = {
  origin: process.env.FRONTEND_URL || "*", // 本番環境ではVercelのURLを設定
  credentials: true,
};

// ミドルウェア
app.use(cors(corsOptions));
app.use(express.json());

// ルート
// ヘルスチェックエンドポイント（認証不要）
app.get("/", (req, res) => {
  res.json({ message: "Food Costing API is running" });
});

// 認証が必要なルート（すべてのAPIエンドポイント）
app.use("/items", authMiddleware, itemsRouter);
app.use("/", authMiddleware, recipeLinesItemsRouter);
app.use("/recipe-lines", authMiddleware, recipeLinesRouter);
app.use("/", authMiddleware, costRouter);
app.use("/base-items", authMiddleware, baseItemsRouter);
app.use("/vendors", authMiddleware, vendorsRouter);
app.use("/vendor-products", authMiddleware, vendorProductsRouter);
app.use("/labor-roles", authMiddleware, laborRolesRouter);
app.use("/non-mass-units", authMiddleware, nonMassUnitsRouter);
app.use("/item-unit-profiles", authMiddleware, itemUnitProfilesRouter);
app.use(
  "/proceed-validation-settings",
  authMiddleware,
  proceedValidationSettingsRouter
);

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
