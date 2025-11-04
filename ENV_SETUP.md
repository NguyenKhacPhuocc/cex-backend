# Backend Environment Variables Setup

Copy this content to your `.env` file in the `backend/` directory.

```env
# ===========================================
# BACKEND ENVIRONMENT VARIABLES
# ===========================================

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATABASE CONFIGURATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Option 1: Use DATABASE_URL (recommended for production)
# Supports both formats: postgres:// or postgresql://
# Supports query parameters (e.g., ?sslmode=require from Neon)
DATABASE_URL=postgresql://user:password@host:port/database
# or with SSL (Neon, Supabase format):
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
# or
DATABASE_URL=postgres://user:password@host:port/database

# Option 2: Use individual variables (alternative)
# DB_HOST=localhost
# DB_PORT=5432
# DB_USERNAME=postgres
# DB_PASSWORD=password
# DB_DATABASE=my_project
# DB_TYPE=postgres

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REDIS CONFIGURATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Option 1: Use REDIS_URL (recommended for Upstash, Railway, etc.)
# Upstash provides URL format: redis://default:password@host:port
REDIS_URL=redis://default:your-password@your-host.upstash.io:6379

# For local development:
# REDIS_URL=redis://localhost:6379

# Option 2: Use individual variables (alternative)
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DATABASE=0

# Note: If REDIS_URL is set, it will be used. Otherwise, individual variables will be used.

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# JWT CONFIGURATION - QUAN TRỌNG!
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Generate strong secrets: openssl rand -base64 32
JWT_ACCESS_SECRET=your-access-secret-min-32-chars-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars-change-this-in-production

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CORS CONFIGURATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Frontend URL - MUST match your deployed frontend domain
# Supports multiple URLs separated by comma
# If protocol (https://) is missing, it will be added automatically
FRONTEND_URL=http://localhost:3000
# For production: https://cex-project.vercel.app
# Or multiple: https://cex-project.vercel.app,https://www.cex-project.vercel.app

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SERVER CONFIGURATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PORT=8000
NODE_ENV=development
# For production: NODE_ENV=production

# DATABASE SYNCHRONIZE (for initial setup only)
# ⚠️ WARNING: Set to true ONLY for first-time setup to create tables
# After tables are created, set to false and use migrations instead
DB_SYNCHRONIZE=false
# For initial setup: DB_SYNCHRONIZE=true (then set back to false)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BOT CONFIGURATION (Optional)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Set to false to disable bots in production
ENABLE_BOTS=false
BOT_COUNT=18
BOT_INITIAL_BALANCE_BTC=10
BOT_INITIAL_BALANCE_USDT=500000
BOT_INITIAL_BALANCE_ETH=20
BOT_INITIAL_BALANCE_DEFAULT=1000
```

## Important Notes:

1. **JWT Secrets**: Generate strong secrets using:

   ```bash
   openssl rand -base64 32
   ```

2. **DATABASE_URL**: Most cloud providers (Railway, Render, Supabase) provide this as a single connection string.

3. **REDIS_URL**: Cloud providers like Upstash provide this as a single URL.

4. **FRONTEND_URL**: Must match your deployed frontend domain exactly (including https://).

5. **NODE_ENV**: Set to `production` when deploying to production.
