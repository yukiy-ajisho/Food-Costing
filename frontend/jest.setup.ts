import "@testing-library/jest-dom";

// グローバルモックを追加したい場合はここに書く
// 例: fetchのダミー実装
if (!global.fetch) {
  global.fetch = (async () =>
    ({ ok: true, json: async () => ({}) } as any)) as any;
}
