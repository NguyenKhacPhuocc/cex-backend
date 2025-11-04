# ✅ Bot Fixes & Debugging Features

## 📝 Summary

Thêm logging chi tiết và debug endpoints để giúp theo dõi và fix vấn đề bot không đặt lệnh.

## 🔧 Changes Made

### 1. Fixed Market Status Query

**File:** `src/modules/bot/bot.service.ts`

- ❌ Before: `where: { status: 'active' as any }` (string comparison)
- ✅ After: `where: { status: MarketStatus.ACTIVE }` (enum comparison)

**Impact:** Bot giờ đúng cách query active markets từ database

### 2. Added Detailed Logging

**File:** `src/modules/bot/bot.service.ts`

Added logs with prefixes:

- `[BOT_INIT]` - Bot initialization logs
- `[BOT_LOOP]` - Trading loop logs
- `[BOT_PRICE]` - Price update logs
- `[BOT_STRATEGY]` - Strategy assignment logs
- `[BOT_EXEC]` - Strategy execution logs
- `[BOT_ORDER]` - Order creation logs

**Example log output:**

```
[BOT_INIT] ENABLE_BOTS=true
[BOT_INIT] Found 15 active markets: BTC_USDT, ETH_USDT, SOL_USDT, ...
[BOT_INIT] ✅ Initialized 18 bots with 270 strategy instances
[BOT_PRICE] Updated prices for 15/15 markets
[BOT_EXEC] Bot bot1@trading.com: BUY 0.01 @ 106900 on BTC_USDT
[BOT_ORDER] ✅ Order created successfully for bot1@trading.com
```

### 3. Added Debug Endpoints

**File:** `src/modules/dev/dev.controller.ts` & `src/modules/dev/dev.service.ts`

#### New Endpoints:

1. **Seed Markets** (Create default markets)

   ```
   POST /api/dev/seed-markets
   Authorization: Bearer ADMIN_TOKEN
   ```

   Creates 15 default trading pairs: BTC, ETH, SOL, BNB, DOGE, XRP, ADA, AVAX, MATIC, LTC, LINK, DOT, TAO, TON, PEPE

2. **Check Bot Status**
   ```
   GET /api/dev/bot-status
   Authorization: Bearer ADMIN_TOKEN
   ```
   Returns:
   - Number of bot users
   - List of all markets and their status
   - List of bot emails and IDs

### 4. Market Status Enum Consistency

**Files:** Updated all queries to use `MarketStatus` enum:

- `bot.service.ts`: All market queries now use `MarketStatus.ACTIVE`
- Fixed compilation errors with proper typing

## 🚀 How to Use

### Step 1: Deploy Backend to Render

```bash
git push origin main
# Render auto-deploys
```

### Step 2: Check Logs on Render

1. Go to **Render Dashboard** → **Web Service** → **Logs**
2. Look for `[BOT_INIT]` logs to see if bot initialized
3. Look for `[BOT_EXEC]` logs to see if bot is trading

### Step 3: If Bot Not Trading

**Option A: Using API**

```bash
# Get admin token first
curl -X POST https://your-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}'

# Check bot status
curl -X GET https://your-backend.onrender.com/api/dev/bot-status \
  -H "Authorization: Bearer YOUR_TOKEN"

# Seed markets if needed
curl -X POST https://your-backend.onrender.com/api/dev/seed-markets \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Option B: Using Postman/API Client**

1. Create collection with 2 requests:
   - POST `/api/dev/seed-markets`
   - GET `/api/dev/bot-status`
2. Add `Authorization: Bearer YOUR_TOKEN` header
3. Send requests and check responses

### Step 4: Check Database

```sql
-- Verify markets are active
SELECT symbol, status FROM markets;

-- Verify bot users exist
SELECT email, role FROM users WHERE email LIKE 'bot%';

-- Verify bot wallets are initialized
SELECT u.email, w.currency, w.balance
FROM wallets w
JOIN users u ON w.user_id = u.id
WHERE u.email LIKE 'bot%';

-- Verify orders are created
SELECT u.email, o.market_symbol, o.side, o.amount, COUNT(*) as count
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.email LIKE 'bot%'
GROUP BY u.email, o.market_symbol, o.side, o.amount;
```

## 🐛 Troubleshooting

| Error Log                             | Problem                       | Solution                                 |
| ------------------------------------- | ----------------------------- | ---------------------------------------- |
| `[BOT_INIT] No active markets found`  | No active markets             | Run `/api/dev/seed-markets`              |
| `[BOT_PRICE] No price found for XXX`  | Binance prices not fetching   | Check Redis + BINANCE_ENABLED env var    |
| `[BOT_EXEC] Failed to execute action` | Error executing strategy      | Check bot wallet balance                 |
| `[BOT_ORDER] Failed to create order`  | Order creation failed         | Check market exists + sufficient balance |
| No logs at all                        | ENABLE_BOTS not set to 'true' | Set `ENABLE_BOTS=true` in Render         |

## 📊 Environment Variables to Check

On Render > Web Service > Environment:

```
ENABLE_BOTS=true
BOT_COUNT=18
BOT_INITIAL_BALANCE_BTC=10
BOT_INITIAL_BALANCE_USDT=500000
BOT_INITIAL_BALANCE_ETH=20
BOT_INITIAL_BALANCE_DEFAULT=1000
BINANCE_ENABLED=true
REDIS_URL=rediss://... (Upstash)
```

## 📚 Related Documentation

- See `BOT_CONFIG.md` for bot configuration details
- See `BOT_DEBUG_GUIDE.md` for detailed debugging guide
- See `DEPLOYMENT_GUIDE.md` for deployment steps

## ✨ What's Fixed

✅ Bot initialization now properly detects active markets  
✅ Detailed logging for every bot action (visible in Render logs)  
✅ Debug endpoints to check bot status  
✅ Seed markets endpoint for automatic market creation  
✅ Proper enum comparison instead of string comparison  
✅ Better error messages for troubleshooting

## 🎯 Next Steps

1. Deploy backend to Render
2. Check logs in Render dashboard
3. If no markets, run `/api/dev/seed-markets`
4. If still no bot trades, check database with SQL queries above
5. Use `/api/dev/bot-status` to verify bot setup
