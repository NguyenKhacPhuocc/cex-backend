# Dev Module - Database Reset API

## Overview

Development utility module for resetting the database and clearing Redis cache. This is useful during development/testing when you need to quickly reset all trading data.

## Endpoint

### Reset Database

```
DELETE /api/dev/reset-database
```

**Authorization**: Requires ADMIN role + JWT authentication

**What it does**:

1.  Clears all Redis data (order books, queues, etc.)
2.  Deletes all trades
3.  Deletes all orders
4.  Deletes all ledger entries
5.  Deletes all transactions
6.  Resets all wallets to initial values:

- **Base Token (USDT)**: 100,000
- **Asset Token (BTC)**: 100

**What it preserves**:

- Users
- User profiles
- Markets
- Wallets (structure preserved, balances reset)

---

## Usage

### Using cURL

```bash
# Login as admin first to get token
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "your-password"
  }'

# Reset database (replace YOUR_ACCESS_TOKEN)
curl -X DELETE http://localhost:8000/api/dev/reset-database \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Using Postman

1. **Login as Admin**
   - Method: `POST`
   - URL: `http://localhost:8000/api/auth/login`
   - Body (JSON):
     ```json
     {
       "email": "admin@example.com",
       "password": "your-password"
     }
     ```
   - Copy the `accessToken` from response

2. **Reset Database**
   - Method: `DELETE`
   - URL: `http://localhost:8000/api/dev/reset-database`
   - Headers:
     ```
     Authorization: Bearer YOUR_ACCESS_TOKEN
     ```

---

## Response

### Success (200 OK)

```json
{
  "message": "Database reset successfully",
  "details": {
    "redis": "Cleared",
    "trades": "Deleted",
    "orders": "Deleted",
    "ledger_entries": "Deleted",
    "transactions": "Deleted",
    "wallets": "Reset to initial values (USDT: 100000, BTC: 100)"
  }
}
```

### Error Responses

**401 Unauthorized** - Not logged in

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

**403 Forbidden** - Not an admin

```json
{
  "statusCode": 403,
  "message": "Forbidden resource"
}
```

---

## Transaction Safety

The reset operation uses **database transactions** to ensure atomicity:

- All operations succeed OR all fail (no partial resets)
- Automatic rollback on any error
- Database consistency guaranteed

---

## Logs

The service outputs detailed logs during reset:

```
🔥 Starting database reset...
📦 Clearing Redis...
✅ Cleared order book for BTCUSDT
✅ Cleared 3 order queues
✅ Cleared 15 order keys
✅ Redis cleared successfully
🗑️ Deleting trades...
🗑️ Deleting orders...
🗑️ Deleting ledger entries...
🗑️ Deleting transactions...
🔄 Resetting 10 wallets...
✅ Reset wallet for user 1 - USDT: 100000
✅ Reset wallet for user 1 - BTC: 100
...
✅ All wallets reset successfully
✅ Database reset completed successfully!
```

---

## Security Warning

**This endpoint is ONLY for development/testing!**

For production:

- Remove `DevModule` from `app.module.ts`
- Or add environment check:
  ```typescript
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException('Not available in production');
  }
  ```

---

## Implementation Details

### Redis Keys Cleared

- `orderbook:{symbol}:asks`
- `orderbook:{symbol}:bids`
- `orderbook:{symbol}:asks:hash`
- `orderbook:{symbol}:bids:hash`
- `order:queue:*`
- `order:*`

### Database Tables Affected

```sql
DELETE FROM trades;          -- All executed trades
DELETE FROM orders;          -- All open/closed/cancelled orders
DELETE FROM ledger_entries;  -- All balance change records
DELETE FROM transactions;    -- All deposit/withdrawal records

UPDATE wallets
SET available = (baseToken ? 100000 : 100),
    locked = 0;
```

---

## Testing Workflow

1. **Place some orders** to create test data
2. **Check database** - Should have trades, orders, etc.
3. **Call reset endpoint** - Clear everything
4. **Verify**:
   - Redis is empty (`redis-cli KEYS *`)
   - All users have 100,000 USDT and 100 BTC
   - No orders or trades in database
   - Users and markets still exist

---

## Future Enhancements

- [ ] Add optional parameters to reset specific data types only
- [ ] Support custom initial balance values
- [ ] Add dry-run mode to preview what will be deleted
- [ ] Export data before reset (backup)
