# 🐛 Bot Debugging Guide - Render

## Tổng Quan

Bot không đặt lệnh khi deploy? Hãy làm theo hướng dẫn này để debug.

---

## 📋 Kiểm Tra Từng Bước

### 1️⃣ Kiểm Tra Logs trên Render

1. Vào **Render Dashboard** > **Web Service** > **Logs**
2. Tìm logs bắt đầu bằng `[BOT_INIT]`, `[BOT_LOOP]`, `[BOT_EXEC]`, `[BOT_ORDER]`

**Logs bạn nên thấy:**

```
[BOT_INIT] ENABLE_BOTS=true
[BOT_INIT] ✅ Bots enabled, starting initialization...
[BOT_INIT] Creating 18 bots...
[BOT_INIT] Found 15 active markets: BTC_USDT, ETH_USDT, SOL_USDT, ...
[BOT_INIT] ✅ Created bot user: bot1@trading.com (ID: xxx)
[BOT_INIT] ✅ Initialized 18 bots with 270 strategy instances
[BOT_INIT] ✅ Bot initialization complete
[BOT_LOOP] 🚀 Starting trading loop with 18 bots...
[BOT_PRICE] 📡 Starting Binance price listener...
[BOT_LOOP] ✅ Trading loop started
[BOT_PRICE] Updated prices for 15/15 markets
[BOT_EXEC] Bot bot1@trading.com: BUY 0.01 @ 106900 on BTC_USDT
[BOT_ORDER] 📝 Creating order for bot1@trading.com: {...}
[BOT_ORDER] ✅ Order created successfully for bot1@trading.com
```

---

### 2️⃣ Nếu Thấy ❌ Logs

#### ❌ `[BOT_INIT] ⚠️ WARNING: No active markets found!`

**Vấn đề:** Không có markets ở trạng thái ACTIVE

**Giải pháp:**

```bash
# Dùng curl hoặc Postman để seed markets
POST https://your-backend.onrender.com/api/dev/seed-markets
Authorization: Bearer YOUR_ADMIN_TOKEN

# Response:
{
  "message": "✅ Successfully seeded 15 new markets",
  "created": 15,
  "markets": [...]
}
```

#### ❌ `[BOT_PRICE] ⚠️ No price found for BTC_USDT`

**Vấn đề:** BinanceService không lấy được giá

**Giải pháp:**

1. Kiểm tra `BINANCE_ENABLED=true` trong Environment Variables
2. Kiểm tra Redis có hoạt động không (xem hướng dẫn Redis bên dưới)
3. Kiểm tra Internet connection

#### ❌ `[BOT_EXEC] ❌ Failed to execute action...`

**Vấn đề:** Lỗi khi tạo order

**Giải pháp:** Xem error message trong logs

- Nếu "insufficient balance" → wallets không được init đúng
- Nếu "market not found" → markets bị xóa hoặc không active

---

### 3️⃣ Sử Dụng Debug Endpoint

#### Check Bot Status

```bash
GET https://your-backend.onrender.com/api/dev/bot-status
Authorization: Bearer YOUR_ADMIN_TOKEN

# Response:
{
  "message": "Bot status report: 18 bots, 15 markets",
  "botCount": 18,
  "markets": [
    { "symbol": "BTC_USDT", "status": "active" },
    { "symbol": "ETH_USDT", "status": "active" },
    ...
  ],
  "botUsers": [
    { "email": "bot1@trading.com", "id": "xxx" },
    ...
  ]
}
```

**Checklist:**

- ✅ `botCount > 0` → Bots được tạo
- ✅ Tất cả `status = "active"` → Markets active
- ✅ `markets.length > 0` → Có markets để trade

---

### 4️⃣ Kiểm Tra Database

#### Vào Supabase/Neon Console

```sql
-- 1. Kiểm tra có markets không
SELECT COUNT(*),
       COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
FROM markets;

-- 2. Kiểm tra markets status
SELECT symbol, status FROM markets ORDER BY symbol;

-- 3. Kiểm tra bot users
SELECT id, email, role FROM users WHERE email LIKE 'bot%' LIMIT 5;

-- 4. Kiểm tra bot wallets
SELECT u.email, w.currency, w.balance
FROM wallets w
JOIN users u ON w.user_id = u.id
WHERE u.email LIKE 'bot%'
LIMIT 10;

-- 5. Kiểm tra có orders không
SELECT o.id, u.email, o.market_symbol, o.side, o.amount, o.price, o.created_at
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.email LIKE 'bot%'
ORDER BY o.created_at DESC
LIMIT 10;
```

---

### 5️⃣ Kiểm Tra Redis

```bash
# Kiểm tra Redis prices có được set không
# Login vào Upstash dashboard hoặc dùng CLI:

redis-cli
> KEYS "binance:price:*"
# Nên thấy keys như: binance:price:BTC_USDT, binance:price:ETH_USDT, ...

> GET binance:price:BTC_USDT
# Nên trả về: "106900.50"

# Nếu không thấy keys:
# 1. Kiểm tra REDIS_URL đúng trong Render Environment Variables
# 2. Kiểm tra BinanceService logs để xem có lỗi connection không
```

---

## 🔧 Troubleshooting Checklist

| Vấn đề                                    | Giải Pháp                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `[BOT_INIT] ❌ Failed to initialize bots` | Xem error message, thường là database connection hoặc markets không tìm thấy |
| `[BOT_INIT] ⚠️ No active markets`         | Chạy POST `/api/dev/seed-markets` để tạo markets                             |
| `[BOT_PRICE] ⚠️ No price found`           | Kiểm tra BINANCE_ENABLED=true, kiểm tra Redis                                |
| `[BOT_EXEC] ❌ Failed to execute action`  | Kiểm tra bot wallets balance, kiểm tra market exists                         |
| `[BOT_ORDER] ❌ Failed to create order`   | Kiểm tra bot balance, kiểm tra order validation                              |
| Bot không đặt lệnh nhưng không có error   | Kiểm tra `ENABLE_BOTS=true`, kiểm tra có active markets không                |

---

## 📝 Quick Reference

**Environment Variables cần check:**

```
ENABLE_BOTS=true
BOT_COUNT=18
BOT_INITIAL_BALANCE_BTC=10
BOT_INITIAL_BALANCE_USDT=500000
BOT_INITIAL_BALANCE_ETH=20
BOT_INITIAL_BALANCE_DEFAULT=1000
BINANCE_ENABLED=true
REDIS_URL=rediss://...
```

**Endpoints:**

- `POST /api/dev/seed-markets` - Tạo markets
- `GET /api/dev/bot-status` - Check bot status
- `DELETE /api/dev/reset-database` - Reset database (xóa tất cả trades/orders)

**Logs Pattern:**

- `[BOT_INIT]` - Khởi tạo bot
- `[BOT_LOOP]` - Trading loop
- `[BOT_PRICE]` - Price updates từ Binance
- `[BOT_STRATEGY]` - Strategy assignments
- `[BOT_EXEC]` - Executing strategies
- `[BOT_ORDER]` - Order creation
