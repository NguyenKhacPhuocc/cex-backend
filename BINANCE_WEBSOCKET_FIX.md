# 🔧 Binance WebSocket Connection Fix

## 🔴 Vấn Đề

Logs thể hiện:

```
✅ Binance WebSocket connected
⚠️ WebSocket connection closed, will reconnect...
[BOT_PRICE] ⚠️ No price found for BTC_USDT
```

WebSocket kết nối nhưng ngay lập tức đóng, khiến bot không lấy được prices.

---

## 🔍 Root Causes

### 1. Không có Active Markets

```
[BOT_INIT] ✅ Initialized 18 bots with 54 strategy instances
```

- ❌ Chỉ 54 strategy instances (18 bots × 3 markets)
- ✅ Nên có 270 instances (18 bots × 15 markets)
- **Giải pháp:** Cần tạo thêm markets

### 2. WebSocket không ổn định

- Binance connects → closes → reconnects (loop)
- CoinCap connects → closes → reconnects (loop)
- **Nguyên nhân:**
  - Network timeout
  - Symbol mapping sai
  - Too many symbols subscribed
  - Rate limit from Binance

### 3. Redis không hoạt động

- Prices không được store vào Redis
- Bot không lấy được prices
- **Giải pháp:** Kiểm tra REDIS_URL

---

## ✅ Giải Pháp Chi Tiết

### Step 1: Tạo Markets

**Cách 1: Dùng API (Khuyên dùng)**

```bash
# SSH vào máy hoặc dùng local curl
POST /api/dev/seed-markets
Authorization: Bearer ADMIN_TOKEN

Response:
{
  "message": "✅ Successfully seeded 15 new markets",
  "created": 15,
  "markets": [...]
}
```

**Cách 2: SQL**

```sql
-- Thêm 15 markets
INSERT INTO markets (symbol, base_asset, quote_asset, status, min_order_size, price_precision, created_at)
VALUES
  ('BTC_USDT', 'BTC', 'USDT', 'active', 0.0001, 2, NOW()),
  ('ETH_USDT', 'ETH', 'USDT', 'active', 0.0001, 2, NOW()),
  ('SOL_USDT', 'SOL', 'USDT', 'active', 0.0001, 2, NOW()),
  ('BNB_USDT', 'BNB', 'USDT', 'active', 0.0001, 2, NOW()),
  ('DOGE_USDT', 'DOGE', 'USDT', 'active', 0.0001, 2, NOW()),
  ('XRP_USDT', 'XRP', 'USDT', 'active', 0.0001, 2, NOW()),
  ('ADA_USDT', 'ADA', 'USDT', 'active', 0.0001, 2, NOW()),
  ('AVAX_USDT', 'AVAX', 'USDT', 'active', 0.0001, 2, NOW()),
  ('MATIC_USDT', 'MATIC', 'USDT', 'active', 0.0001, 2, NOW()),
  ('LTC_USDT', 'LTC', 'USDT', 'active', 0.0001, 2, NOW()),
  ('LINK_USDT', 'LINK', 'USDT', 'active', 0.0001, 2, NOW()),
  ('DOT_USDT', 'DOT', 'USDT', 'active', 0.0001, 2, NOW()),
  ('TAO_USDT', 'TAO', 'USDT', 'active', 0.0001, 2, NOW()),
  ('TON_USDT', 'TON', 'USDT', 'active', 0.0001, 2, NOW()),
  ('PEPE_USDT', 'PEPE', 'USDT', 'active', 0.0001, 2, NOW());

-- Verify
SELECT COUNT(*), COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
FROM markets;
```

### Step 2: Kiểm Tra Markets

```bash
GET /api/dev/bot-status
Authorization: Bearer ADMIN_TOKEN

# Response:
{
  "botCount": 18,
  "markets": [
    { "symbol": "BTC_USDT", "status": "active" },
    { "symbol": "ETH_USDT", "status": "active" },
    ...  // should have 15 markets
  ]
}
```

**Check:** Markets count should be 15 (or more), all with `status: "active"`

### Step 3: Kiểm Tra Redis

```bash
# Login vào Upstash dashboard
# Or use Redis CLI:

redis-cli
> KEYS "binance:price:*"

# Should see:
# 1) "binance:price:BTC_USDT"
# 2) "binance:price:ETH_USDT"
# 3) "binance:price:SOL_USDT"
# ... etc

> GET binance:price:BTC_USDT
# Should return something like: "106900.50"
```

**If no keys:**

1. Check `REDIS_URL` is correct in `.env`
2. Check Upstash Redis is running
3. Check network connectivity to Upstash

### Step 4: Kiểm Tra Logs

```bash
# Local:
npm run start:dev

# Production (Render):
# Vào Render Dashboard > Logs
```

**Logs you should see:**

```
[BOT_INIT] Found 15 active markets: BTC_USDT, ETH_USDT, SOL_USDT, ...
✅ Binance WebSocket connected
[BOT_PRICE] Updated prices for 15/15 markets
[BOT_EXEC] Bot bot1@trading.com: BUY 0.01 @ 106900 on BTC_USDT
[BOT_ORDER] ✅ Order created successfully
```

### Step 5: Kiểm Tra Orders Được Tạo

```sql
SELECT u.email, o.market_symbol, o.side, o.amount, o.price, o.created_at
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.email LIKE 'bot%'
ORDER BY o.created_at DESC
LIMIT 20;
```

Should see orders from bot users.

---

## 🛠️ Troubleshooting WebSocket Issues

### Issue: WebSocket connects then closes immediately

**Solutions:**

1. **Check symbol mapping:**

```sql
SELECT * FROM markets ORDER BY symbol;
```

Verify symbols are in format: `BASE_QUOTE` (e.g., `BTC_USDT`)

2. **Reduce number of symbols:**
   If too many symbols, Binance might reject:

```env
# Edit BOT_COUNT to reduce number of bots
BOT_COUNT=5  # Try with fewer bots first
```

3. **Use CoinCap instead of Binance:**

```env
# In .env
PRICE_PROVIDER=coincap
BINANCE_ENABLED=false
```

4. **Check network:**

```bash
# Test Binance connectivity
curl -I https://stream.binance.com:9443/stream

# Should return 200 or similar HTTP status
```

### Issue: No prices found (Redis empty)

**Solutions:**

1. **Check Redis connection:**

```bash
# Test Redis
redis-cli
> PING
# Should return: PONG

> SET test_key test_value
> GET test_key
# Should return: test_value
```

2. **Check if prices are being processed:**

```bash
# Watch Redis in real-time
redis-cli MONITOR

# You should see SET commands for binance:price:XXX
```

3. **Check symbol formatting:**

```
Symbol in DB:  "BTC_USDT"
Expected:      "BTC_USDT"  (uppercase with underscore)
Binance:       "BTCUSDT"   (no underscore)
```

---

## 📋 Checklist

- [ ] Markets table has 15+ records with `status = 'active'`
- [ ] Bot initialized with >= 270 strategy instances (not 54)
- [ ] Redis has keys like `binance:price:BTC_USDT`
- [ ] Logs show WebSocket connected and staying connected
- [ ] Logs show price updates: `[BOT_PRICE] Updated prices for 15/15 markets`
- [ ] Logs show bot executing: `[BOT_EXEC] Bot bot1@trading.com:`
- [ ] Orders table has orders from bot users
- [ ] No `[BOT_PRICE] ⚠️ No price found` warnings in logs

---

## 🚀 After Fixing

Restart backend:

```bash
# Local
npm run start:dev

# Production (Render)
# Push changes:
git add .
git commit -m "Fix: Add markets and WebSocket improvements"
git push origin main
# Render auto-deploys
```

Then check logs immediately for bot activity!

---

## 📞 Still Not Working?

1. Post error logs to file:

   ```bash
   # Local
   npm run start:dev > logs.txt 2>&1
   ```

2. Check all environment variables:

   ```env
   ENABLE_BOTS=true
   BOT_COUNT=18
   BINANCE_ENABLED=true
   REDIS_URL=rediss://...
   DATABASE_URL=postgresql://...
   ```

3. Test database connectivity:

   ```bash
   npm run typeorm migration:generate src/migrations/test
   ```

4. Verify models:
   ```bash
   npm run typeorm schema:sync
   ```
