// 環境変数を最初に読み込む（インポートより前）
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();

import express from "express";
import cors from "cors";
import itemsRouter from "./routes/items";
import recipeLinesRouter from "./routes/recipe-lines";
import recipeLinesItemsRouter from "./routes/recipe-lines-items";
import costRouter from "./routes/cost";
import baseItemsRouter from "./routes/base-items";
import vendorsRouter from "./routes/vendors";
import vendorProductsRouter from "./routes/vendor-products";
import laborRolesRouter from "./routes/labor-roles";
import nonMassUnitsRouter from "./routes/non-mass-units";

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
app.get("/", (req, res) => {
  res.json({ message: "Food Costing API is running" });
});

app.use("/items", itemsRouter);
app.use("/", recipeLinesItemsRouter);
app.use("/recipe-lines", recipeLinesRouter);
app.use("/", costRouter);
app.use("/base-items", baseItemsRouter);
app.use("/vendors", vendorsRouter);
app.use("/vendor-products", vendorProductsRouter);
app.use("/labor-roles", laborRolesRouter);
app.use("/non-mass-units", nonMassUnitsRouter);

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
