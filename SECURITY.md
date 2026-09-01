# 安全性回報

## 怎麼回報

請走 GitHub 的 **Private vulnerability reporting**（本 repo 的 Security 分頁 →
Report a vulnerability）。不要開公開 issue。

我不是專職維護者，這是個人專案，沒有 SLA 也沒有獎金——但只要收到就會處理。

## 攻擊面

這個 app 沒有伺服器、沒有帳號、沒有後端 API，所以一般 web app 的多數類別不適用
（沒有 SQL 注入、沒有伺服器端 SSRF、沒有 session 可以劫持）。實際存在的面向只有三塊：

1. **同步協定**（`packages/client/src/sync/`）——WebRTC + Trystero/Nostr。
   房間碼是 6 碼、31 字集（約 29.8 bits），是配對當下的短暫秘密。
   `sync/rowSchema.ts` 是唯一的 wire 驗證層；能繞過它把畸形的列送進
   `core/merge.ts` 的話，那是真的問題（例如構造一個字典序永遠勝出的 `updatedAt`，
   讓某筆記錄再也無法被編輯或復原）。
2. **發票解析**（`packages/core/src/einvoice.ts`）——輸入來自相機掃到的任意 QR，
   完全不可信。它的契約是**永不 throw**、壞資料一律分級回傳錯誤。
3. **XSS**——React 的預設轉義是唯一防線，repo 內沒有任何 `dangerouslySetInnerHTML`。

## 不算漏洞的

- 拿到房間碼的人可以同步——那是設計，房間碼就是憑證
- 實體接觸到未鎖定的裝置就能看到帳本——local-first 的資料就在裝置上，
  這由作業系統的鎖定機制負責
- 公共 Nostr relay 看得到有連線發生——它們看不到帳本內容，SDP 是加密的
