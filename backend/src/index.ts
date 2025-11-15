import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// 環境変数を読み込む
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ミドルウェア
app.use(cors());
app.use(express.json());

// ルート
app.get("/", (req, res) => {
  res.json({ message: "Food Costing API is running" });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
