# Self-Trade Prevention

## Overview

Self-trade prevention ensures that a user cannot trade with themselves. This is a critical feature in order matching engines to prevent wash trading and maintain market integrity.

---

## How It Works (Binance-like Behavior)

### ✅ Correct Behavior

When a user places an order that would match with their own existing order:

1. **Detection**: Engine detects that `bestMatch.user.id === incomingOrder.user.id`
2. **Skip**: Engine SKIPS the self-match (does NOT execute trade)
3. **Preserve**: BOTH orders remain in the orderbook
4. **Wait**: Orders wait for OTHER users to match

### ❌ Previous Incorrect Behavior

```typescript
// WRONG - Was removing user's own order from orderbook
if (bestMatch.user.id === order.user.id) {
  await this.orderBookService.remove(bestMatch); // ❌ DON'T DO THIS!
  continue;
}
```

This caused the user's first order to disappear from the orderbook!

---

## Implementation

### Limit Orders

```typescript
// Self-trade prevention (self-trade prevention)
// Skip this order but keep it in orderbook for other users to match
if (bestMatch.user.id === order.user.id) {
  this.logger.log(
    `Self-trade prevention: Skipping order ${bestMatch.id} (same user ${order.user.id})`,
  );
  // Do NOT remove - just break to stop matching
  // Both orders will remain in orderbook for other users
  break;
}
```

**Result**:

- Incoming limit order: Added to orderbook (if has remaining amount)
- Existing limit order: Remains in orderbook
- Both wait for other users

### Market Orders

```typescript
// Prevent self-matching (self-trade prevention)
// For market orders, skip if it's the same user
if (bestMatch.user.id === order.user.id) {
  this.logger.log(
    `Self-trade prevention: Market order ${order.id} cannot match with own order ${bestMatch.id}`,
  );
  // Market order fails to execute if best match is own order
  // Stop processing - market order may remain partially filled or unfilled
  break;
}
```

**Result**:

- Market order: May remain UNFILLED or PARTIALLY_FILLED
- Existing limit order: Remains in orderbook
- User gets notification that market order couldn't fill

---

## Examples

### Example 1: Limit Orders

```
User A places:
1. SELL 0.1 BTC @ 100,000 USDT (order goes to orderbook)
2. BUY 0.1 BTC @ 100,000 USDT (incoming order)

✅ Expected Behavior:
- No match occurs (self-trade prevention)
- SELL order remains in orderbook @ 100,000
- BUY order also added to orderbook @ 100,000
- Both orders wait for User B or User C to match

❌ Old Incorrect Behavior:
- SELL order was REMOVED from orderbook
- Only BUY order remained
- User lost their SELL order!
```

### Example 2: Market Order vs Own Limit

```
User A places:
1. SELL 0.1 BTC @ 100,000 USDT (limit order in orderbook)
2. BUY 0.1 BTC @ MARKET (market order)

✅ Expected Behavior:
- Market order tries to match
- Detects best ask is own order
- Self-trade prevention triggers
- Market order fails to fill (status: OPEN or PARTIALLY_FILLED if matched others first)
- SELL limit order remains in orderbook

Note: Market order may appear "failed" to user, which is correct behavior
```

### Example 3: Multiple Users

```
Orderbook:
SELL 0.1 BTC @ 101,000 (User A)
SELL 0.1 BTC @ 100,000 (User A) ← Best ask
SELL 0.05 BTC @ 99,000 (User B)

User A places BUY @ MARKET:
1. Best match: SELL 0.05 @ 99,000 (User B) ✅ Match!
2. Next best: SELL 0.1 @ 100,000 (User A) ❌ Skip (self-trade)
3. Break - remaining amount not filled

Result:
- User A bought 0.05 BTC from User B
- User A's SELL @ 100,000 still in orderbook
- User A's SELL @ 101,000 still in orderbook
```

---

## Testing Scenarios

### Test 1: Same User Opposite Sides

```bash
# User 1 login
POST /api/auth/login
{ "email": "user1@test.com", "password": "..." }

# Place SELL order
POST /api/orders
{
  "marketSymbol": "BTCUSDT",
  "side": "sell",
  "type": "limit",
  "price": 100000,
  "amount": 0.1
}

# Place BUY order (should NOT match with own SELL)
POST /api/orders
{
  "marketSymbol": "BTCUSDT",
  "side": "buy",
  "type": "limit",
  "price": 100000,
  "amount": 0.1
}

# Verify: Both orders in orderbook
GET /api/orders/open
# Should see 2 orders (1 BUY, 1 SELL)
```

### Test 2: Cross-User Matching

```bash
# User 1: Place SELL
POST /api/orders (User 1 token)
{ "side": "sell", "price": 100000, "amount": 0.1 }

# User 2: Place BUY (should match!)
POST /api/orders (User 2 token)
{ "side": "buy", "price": 100000, "amount": 0.1 }

# Verify: Orders matched, trade executed
GET /api/trades/market/BTCUSDT
# Should see 1 trade between User 1 and User 2
```

---

## Logs to Watch

### Self-Trade Detected (Limit Order)

```
Self-trade prevention: Skipping order abc-123 (same user 1)
Order def-456 saved to DB with status OPEN
```

### Self-Trade Detected (Market Order)

```
Self-trade prevention: Market order xyz-789 cannot match with own order abc-123
Order xyz-789 saved to DB with status PARTIALLY_FILLED
```

---

## Database State After Self-Trade Prevention

### Orders Table

```sql
SELECT id, user_id, side, price, amount, filled, status
FROM orders
WHERE user_id = 1;

-- Expected: Both orders present
id         | user_id | side | price  | amount | filled | status
-----------|---------|------|--------|--------|--------|-------
abc-123    | 1       | SELL | 100000 | 0.1    | 0      | OPEN
def-456    | 1       | BUY  | 100000 | 0.1    | 0      | OPEN
```

### Trades Table

```sql
SELECT * FROM trades WHERE buyer_id = 1 AND seller_id = 1;

-- Expected: Empty (no self-trades)
(0 rows)
```

---

## Benefits

1. **Prevents Wash Trading**: Users cannot artificially inflate volume
2. **Fair Market**: Orders available for genuine cross-user trading
3. **Compliance**: Meets regulatory requirements
4. **User Trust**: Transparent and predictable behavior

---

## Edge Cases Handled

### 1. Partial Self-Match

```
User has: SELL 1 BTC @ 100k
User places: BUY 0.5 BTC @ MARKET

Other user has: SELL 0.3 BTC @ 99k

Result:
- Match 0.3 BTC with other user ✅
- Skip own 1 BTC order ❌
- BUY order: 0.2 BTC remaining, status PARTIALLY_FILLED
```

### 2. Only Own Orders in Book

```
User has: SELL 1 BTC @ 100k (only order in book)
User places: BUY 1 BTC @ MARKET

Result:
- No match possible (self-trade prevention)
- BUY market order: status OPEN, filled = 0
- SELL order: remains in orderbook
```

### 3. Multiple Own Orders

```
User has:
- SELL 0.5 BTC @ 101k
- SELL 0.5 BTC @ 100k

User places: BUY 1 BTC @ MARKET

Result:
- Skip both own orders
- BUY order: unfilled (no other sellers)
- Both SELL orders: remain in orderbook
```

---

## Comparison with Other Strategies

| Strategy                | Behavior                            | Use Case                   |
| ----------------------- | ----------------------------------- | -------------------------- |
| **CANCEL_NEWEST**       | Cancel incoming order               | Conservative               |
| **CANCEL_OLDEST**       | Cancel existing order               | Favor new orders           |
| **CANCEL_BOTH**         | Cancel both orders                  | Strict prevention          |
| **DECREASE_AND_CANCEL** | Decrease quantity, cancel remainder | Partial execution          |
| **ALLOW**               | Allow self-trade                    | Testing/internal transfers |

**Our Implementation**: Similar to `CANCEL_NEWEST` but we keep both orders in orderbook (don't cancel)

---

## Future Enhancements

- [ ] Add configuration option for different self-trade prevention strategies
- [ ] User-selectable STP mode per order (like Binance `selfTradePreventionMode`)
- [ ] Metrics tracking: count of prevented self-trades
- [ ] Admin dashboard: view users with frequent self-trade attempts
