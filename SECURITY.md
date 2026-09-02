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
- 牽線的 relay 看得到有連線發生——它們看不到帳本內容，SDP 是加密的。
  這裡面**有一台是本專案作者自架的**（`wss://relay.arc.idv.tw`），其餘是陌生人營運的公共 relay；
  兩者拿到的東西一模一樣。**看得到 / 看不到什麼**列在下一節，那不是漏洞，但你有權知道

## 第三方看得到什麼

同步不需要一台存帳本的伺服器，但它需要有人幫兩支手機牽線（交換 SDP）。
這一節講清楚**牽線的人**看得到什麼。

配對時，兩支手機會連上一組 Nostr relay。清單是**明寫的**（`sync/relays.ts`），
不是套件自己挑的 —— 由兩段組成：

**1. 錨點：`wss://relay.arc.idv.tw`（本專案作者自架）**

要講在最前面：**這台是我營運的**，所以配對時你的 IP 會被我這邊看到。
它的存在理由是「兩支手機永遠至少共用一台 relay」，不是為了看什麼。
下面那張「看得到 / 看不到」的表對它一字不差地適用 —— 它跟其他 relay 拿到的東西完全一樣，
沒有任何額外資訊。程式是開源的（[arc119226/relay](https://github.com/arc119226/relay)），
**什麼都不存**是結構性事實：那支程式裡沒有任何 `ctx.storage` 呼叫，有原始碼比對測試守著。
它自己的隱私說明在那個 repo 的 `SECURITY.md`。

不想連它的話，把 `sync/relays.ts` 的 `ANCHOR` 換成別台或自己架一份即可。

**2. 公共的：`public/relays.json` 裡那幾台**（陌生人營運，可隨時更換）

```
wss://staging.yabu.me
wss://relay2.angor.io
wss://relay.damus.io
wss://nos.lol
wss://relay.primal.net
```

這段是**可以遠端更新**的：改那份 JSON 部署上去，兩支手機下次開 app 就換過來。
所以上面這串會變 —— 以 app 裡「設定 → 同步中繼站」顯示的為準，那裡列的是當下真正在用的。

> 早期版本不是這樣：清單烤在 `@trystero-p2p/nostr` 裡（0.25.3 是 47 個），
> 實際用其中 5 個，選法是以 `appId` 為種子的定序洗牌
> （`shuffle(relays, strToNum(appId)).slice(0, 5)`）。改成明寫是因為**清單增刪任何一個，
> 洗出來的 5 個就可能與舊版毫無交集** —— 升級套件就可能讓兩支手機永遠配不上對。

**這些 relay 的營運者（包含錨點那台）看得到：**

- 你的 **IP 位址**與**連線時間**
- 房間 topic 的**雜湊**（不是房間碼本身）
- 有一段加密資料流過（約 2 KB）

**看不到：**

- **帳本內容**——它完全不經過 relay，走的是兩支手機之間的 WebRTC 直連
- **SDP 的內容**——以 `appId` + 房間碼派生的金鑰加密
- 房間碼本身

同一個 Wi-Fi 下兩機走 host candidate 直連，relay 只在配對那幾秒經手 signaling。
異網情境還會用到 Google 的公共 STUN（`stun.l.google.com`），它同樣只看得到 IP 與時間。

**全部都不想連的話**：`sync/relays.ts` 的 `ANCHOR` 與 `public/relays.json` 兩處換掉就完全接管
（`relayConfig.urls` 給了就原樣全用）。代價是那份清單得自己維護 ——
`tools/probe-relays.mjs` 可以逐台驗還能不能用。
