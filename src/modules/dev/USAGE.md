# Quick Usage Guide - Reset Database API

## Quick Start

### 1. Ensure you have an ADMIN user

Check database:

```sql
SELECT id, email, role FROM users WHERE role = 'ADMIN';
```

If no admin exists, create one manually:

```sql
INSERT INTO users (email, password, role, name, created_at, updated_at)
VALUES (
  'admin@test.com',
  '$2b$10$xyz...', -- Use bcrypt to hash 'admin123'
  'ADMIN',
  'Admin User',
  NOW(),
  NOW()
);
```

### 2. Login as Admin

**Request:**

```bash
POST http://localhost:8000/api/auth/login
Content-Type: application/json

{
  "email": "admin@test.com",
  "password": "admin123"
}
```

**Response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1...",
  "refreshToken": "eyJhbGciOiJIUzI1..."
}
```

Copy the `accessToken`.

### 3. Reset Database

**Request:**

```bash
DELETE http://localhost:8000/dev/reset-database
Authorization: Bearer YOUR_ACCESS_TOKEN
```

**Response:**

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

---

## 📋 Using cURL

### Full workflow:

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}' \
  | jq -r '.accessToken')

# 2. Reset database
curl -X DELETE http://localhost:8000/dev/reset-database \
  -H "Authorization: Bearer $TOKEN" \
  | jq

# Output:
# {
#   "message": "Database reset successfully",
#   "details": {
#     "redis": "Cleared",
#     "trades": "Deleted",
#     "orders": "Deleted",
#     "ledger_entries": "Deleted",
#     "transactions": "Deleted",
#     "wallets": "Reset to initial values (USDT: 100000, BTC: 100)"
#   }
# }
```

---

## ⚡ Verify Reset

### Check Redis is cleared:

```bash
redis-cli KEYS "*"
# Should return: (empty array)
```

### Check database:

```sql
-- Should return 0
SELECT COUNT(*) FROM trades;
SELECT COUNT(*) FROM orders;
SELECT COUNT(*) FROM ledger_entries;
SELECT COUNT(*) FROM transactions;

-- Check wallets are reset
SELECT
  u.email,
  w.currency,
  w.available,
  w.frozen,
  w.balance
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE w.wallet_type = 'spot'
ORDER BY u.email, w.currency;

-- Expected: All USDT = 100000, All BTC = 100
```

---

## 🎯 Common Scenarios

### Scenario 1: Testing Order Matching

```bash
# 1. Place some test orders (creates trades, orders, ledger entries)
# 2. Reset database
curl -X DELETE http://localhost:8000/dev/reset-database \
  -H "Authorization: Bearer $TOKEN"
# 3. All trading data cleared, wallets reset
# 4. Ready for new test
```

### Scenario 2: Reset Between Tests

```bash
# After each test suite
npm run test:e2e
curl -X DELETE http://localhost:8000/dev/reset-database -H "Authorization: Bearer $TOKEN"
npm run test:e2e  # Clean state!
```

---

## Important Notes

1. **ADMIN Only**: Only users with `role = 'ADMIN'` can use this endpoint
2. **Development Only**: Remove `DevModule` in production!
3. **Transaction Safety**: Uses database transactions - all succeed or all rollback
4. **Data Loss**: This PERMANENTLY deletes trading data!
5. **Preserved Data**: Users, markets, and user profiles are NOT deleted

---

## 🔒 Security Checklist

- [ ] Remove `DevModule` from `app.module.ts` in production
- [ ] Change admin password after first use
- [ ] Restrict admin user creation to trusted personnel
- [ ] Add environment check if keeping module:
  ```typescript
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException('Not available in production');
  }
  ```

---

## 🐛 Troubleshooting

### Error: "Unauthorized"

→ Token expired or invalid. Login again.

### Error: "Forbidden resource"

→ User is not an admin. Check `role` in database.

### Error: "Cannot find module..."

→ Restart backend server after installing dependencies.

### Reset seems incomplete

→ Check backend logs for detailed error messages.
