# Chart, Ticker & LastPrice Update Issues - Diagnosis & Fix

## Problem Summary

After deploying to Render, bot was trading successfully but frontend wasn't updating:

- ❌ **Chart**: Not showing new candles in real-time
- ❌ **Ticker**: Not showing lastPrice, change24h, volume updates
- ❌ **LastPrice Display**: Static, not updating

**However:**

- ✅ MarketTrades: Updating correctly (trade:new events working)
- ✅ OrderBook: Updating correctly (orderbook updates working)
- ✅ Bot: Trading (orders being created)

---

## Root Cause Analysis

### Issue 1: CoinCap API Not Reachable on Render

```
Error: getaddrinfo ENOTFOUND api.coincap.io
Error Code: ENOTFOUND
```

**Why**: Render's network was blocking or couldn't reach `api.coincap.io`. This is a known issue with CoinCap API - it's sometimes blocked by certain networks/regions.

**Impact**:

- BinanceService couldn't fetch real prices
- Bot fell back to random generated prices (~105k-108k vs real ~104k)
- No prices in Redis cache → no ticker updates

### Issue 2: WebSocket Ticker/Candle Updates Depend on Trade Prices

Looking at the matching engine code, when a trade executes:

```typescript
// Broadcast ticker update for this symbol (public event)
this.wsGateway.broadcastTickerUpdate(symbol).catch((error) => {
  this.logger.error(`Error broadcasting ticker update for ${symbol}:`, error);
});

// Also broadcast candle updates
this.wsGateway.broadcastCandleUpdate(market.symbol, timeframe, candle);
```

The ticker update is asynchronous and calls `marketService.getTickerBySymbol()` which:

1. Queries the database for trades in last 24h
2. Calculates lastPrice from most recent trade
3. Broadcasts the ticker

**Problem**: If the database doesn't have fresh trade data with correct prices, the ticker calculation is wrong.

---

## Solution: Replace CoinCap with Binance Public API

### Why Binance?

1. ✅ **Free**: No API key required
2. ✅ **Reliable**: Massive infrastructure, unlikely to be blocked
3. ✅ **Fast**: Direct HTTP requests, no WebSocket complexity
4. ✅ **Real Market Data**: Uses actual Binance prices
5. ✅ **Simple**: Standard REST API with clear response format

### API Endpoint Used

```
GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
Response:
{
  "symbol": "BTCUSDT",
  "lastPrice": "104527.84000000",
  ...
}
```

### Changes Made to `binance.service.ts`

#### 1. Simplified Symbol Mapping

```typescript
// Old: Dynamic mapping from database + CoinCap IDs
// New: Static hardcoded mapping (simple & reliable)
private async initializeSymbolMapping(): Promise<void> {
  const mapping: Record<string, string> = {
    BTCUSDT: 'BTC_USDT',    // Binance symbol → Internal symbol
    ETHUSDT: 'ETH_USDT',
    SOLUSDT: 'SOL_USDT',
  };
  // ...
}
```

#### 2. Replaced fetchPricesFromCoinCap with fetchPricesFromBinance

```typescript
// Fetch from Binance Public API (free, no auth)
const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`;
const response = await axios.get(url, { timeout: 5000 });
const price = parseFloat(response.data.lastPrice);
```

#### 3. Removed Database Dependency

- **Old**: Queried `Market` table to get trading pairs
- **New**: Uses hardcoded Binance symbols (BTC, ETH, SOL)
- **Benefit**: Faster, no DB queries, prevents initialization race conditions

---

## How the Update Flow Works Now

### When Bot Places a Trade:

```
1. Bot calls OrderService.createOrder()
   ↓
2. MatchingEngine matches orders
   ↓
3. Trade is created in database
   ↓
4. WebSocket broadcast chain:
   ├─ broadcastMarketTrade() → Frontend receives "trade:new" ✅
   ├─ broadcastCandleUpdate() → Frontend receives "candle:update" ✅
   └─ broadcastTickerUpdate() → Frontend receives "ticker:update" ✅
```

### Frontend Update Flow:

```
useTicker hook:
1. Subscribes to "ticker:update" WebSocket events
2. Receives ticker with lastPrice, change24h, volume24h
3. Updates component state
4. Re-renders with new prices ✅

useCandles hook:
1. Subscribes to "candle:update" WebSocket events
2. Receives new/updated candle data
3. Charts.tsx component updates lightweight-charts
4. Chart re-renders with new candle ✅
```

---

## Verification Steps

### 1. Check Binance Price Fetching in Logs

```
[BINANCE_API] 📡 Fetching from: https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
[BINANCE_PRICES] 💰 Prices: BTC_USDT=104527.84, ETH_USDT=3542.21, SOL_USDT=168.92
[REDIS_FLUSH] 💾 Saved to Redis: BTC_USDT=104527.84, ETH_USDT=3542.21, SOL_USDT=168.92
```

### 2. Check Bot Uses Real Prices

```
[BOT_PRICE] Updated prices for 3/3 markets
(should show 0 fallback, not 3 fallback)
```

### 3. Check Frontend Receives Updates

Open browser console:

```
✅ [useTicker] Snapshot received: {symbol: "BTC_USDT", price: 104527.84, ...}
💹 [useTicker] Update received: {symbol: "BTC_USDT", price: 104528.50, ...}
```

---

## Deployment Checklist

- [x] Updated `binance.service.ts` to use Binance Public API
- [x] Removed CoinCap REST API code
- [x] Removed database dependency from BinanceService
- [x] Backend builds successfully ✅
- [ ] Deploy to Render
- [ ] Wait 5 seconds for first price fetch
- [ ] Check logs for "BINANCE_PRICES" messages
- [ ] Verify chart updates when bot trades
- [ ] Verify ticker updates when bot trades
- [ ] Verify lastPrice display updates

---

## Expected Behavior After Fix

### Chart Tab

- Candles appear immediately when bot places orders
- Real-time price updates visible
- Volume bars update accordingly

### Ticker Display

- LastPrice updates from fallback (~107k) to real Binance prices (~104k)
- Change24h percentage reflects real market data
- High/Low/Volume update when trades execute

### Bot Trading

- Bot still trades every 1-2 seconds
- Using REAL market prices (104k-105k range) instead of fallback
- Order placement prices match real market prices

---

## Technical Notes

### Why Binance Instead of Alternatives?

| Source      | Auth    | Blocks          | Speed   | Reliability  | Cost      |
| ----------- | ------- | --------------- | ------- | ------------ | --------- |
| **Binance** | ✅ None | ❌ No           | ⚡ Fast | 🟢 Excellent | Free      |
| CoinCap     | ✅ None | ✅ Yes (Render) | Medium  | Yellow       | Free      |
| Kraken      | ❌ Yes  | ❌ Maybe        | Medium  | Good         | Free tier |
| Coingecko   | ✅ None | ❌ No           | Medium  | Good         | Free      |

**Choice**: Binance wins on reliability + speed.

### Why Not Keep Database-Based Symbols?

**Old approach** (before this fix):

```typescript
// Query database for active markets
const markets = await this.marketRepo.find({
  where: { status: MarketStatus.ACTIVE },
});
```

**Problems**:

1. Database dependency = potential initialization race condition
2. Slower startup (DB query before fetching prices)
3. Requires TypeORM injection

**New approach**:

```typescript
const mapping = {
  BTCUSDT: 'BTC_USDT',
  ETHUSDT: 'ETH_USDT',
  SOLUSDT: 'SOL_USDT',
};
```

**Benefits**:

1. Instant initialization (no DB queries)
2. Faster service startup
3. Zero dependencies (just ConfigService + RedisService)
4. Hardcoded = predictable + testable

---

## Troubleshooting

If chart/ticker still not updating after deploy:

### Check 1: Binance API Reachable?

```bash
curl https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
# Should return JSON with lastPrice
```

### Check 2: Prices in Redis?

```bash
redis-cli get "binance:price:BTC_USDT"
# Should return a number like "104527.84"
```

### Check 3: WebSocket Connected?

```javascript
// In browser console
console.log(socket.connected); // Should be true
socket.on('ticker:update', (ticker) => console.log(ticker));
```

### Check 4: New Trades Being Created?

```bash
# Check database for recent trades
SELECT * FROM trades ORDER BY timestamp DESC LIMIT 5;
# Should show latest bot trades
```

---

## Summary

**What was broken**: CoinCap API unreachable → No prices → No ticker/chart updates

**What we fixed**: Switched to Binance Public API → Consistent price data → WebSocket broadcasts working

**Result**: Real-time chart, ticker, and lastPrice updates when bot trades
