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
- 公共 Nostr relay 看得到有連線發生——它們看不到帳本內容，SDP 是加密的。
  它們**看得到的東西**列在下一節，那不是漏洞，但你有權知道

## 第三方看得到什麼

同步不需要我們的伺服器，但它需要**別人的** relay 來牽線。這一節講清楚那些人看得到什麼。

配對時，兩支手機會連上公共 Nostr relay 交換連線協商訊息（SDP）。清單烤在
`@trystero-p2p/nostr` 套件裡（截至 0.25.3 是 47 個），而**實際只會用其中 5 個**——
選法是以 `appId` 為種子的定序洗牌（`shuffle(relays, strToNum(appId)).slice(0, 5)`）。
必須是決定性的，否則兩支手機不會在同一批 relay 上碰頭。

以 `appId = 'zhangben-sync-v1'` 推出來的就是這 5 個（會隨 trystero 版本變動）：

    wss://hornetstorage.net/relay
    wss://slick.mjex.me
    wss://staging.yabu.me
    wss://relay2.angor.io
    wss://communities.nos.social

這些 relay 的營運者看得到：

- 你的 **IP 位址**與**連線時間**
- 房間 topic 的**雜湊**（不是房間碼本身）
- 有一段加密資料流過（約 2 KB）

看不到：

- **帳本內容**——它完全不經過 relay，走的是兩支手機之間的 WebRTC 直連
- **SDP 的內容**——以 `appId` + 房間碼派生的金鑰加密
- 房間碼本身

同一個 Wi-Fi 下兩機走 host candidate 直連，relay 只在配對那幾秒經手 signaling。
異網情境還會用到 Google 的公共 STUN（`stun.l.google.com`），它同樣只看得到 IP 與時間。

**不想用公共 relay 的話**：`getRelays` 的第一個分支是 `config.relayConfig?.urls`，
在 `sync/trystero.ts` 的 `joinRoom` 設定裡傳自己的清單就完全接管。
代價是那份清單得自己維護。
