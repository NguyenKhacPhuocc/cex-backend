# 🔴 Hướng Dẫn Kết Nối Upstash Redis

## Bước 1: Tạo Redis Database trên Upstash

1. Đăng ký tại https://upstash.com
2. Click "Create Database"
3. Chọn:
   - **Type**: Redis
   - **Region**: Chọn region gần bạn (Singapore, Tokyo, etc.)
   - **Name**: Đặt tên database (ví dụ: `my-project-redis`)
4. Click "Create"
5. Upstash sẽ cung cấp **Redis URL**

## Bước 2: Copy Redis URL

Upstash cung cấp URL có thể có 2 format:

**Format 1 (TLS/SSL - phổ biến):**

```
rediss://default:your-password@your-host.upstash.io:6379
```

Lưu ý: `rediss://` (có 2 chữ 's') = SSL/TLS connection

**Format 2 (Non-TLS):**

```
redis://default:your-password@your-host.upstash.io:6379
```

**Lưu ý:** Upstash có thể cung cấp 2 loại URL:

- **REST URL** (dùng cho REST API) - KHÔNG dùng cái này
- **Redis URL** hoặc **TLS URL** (dùng cho Redis client) - Dùng cái này ✅

Code tự động detect TLS nếu URL bắt đầu với `rediss://`

## Bước 3: Cấu Hình trong Project

### Cách 1: Dùng REDIS_URL (Khuyến nghị)

Thêm vào file `.env` hoặc environment variables trên Render:

```env
REDIS_URL=redis://default:your-password@your-host.upstash.io:6379
```

**Ví dụ thực tế:**

```env
REDIS_URL=redis://default:AXXXaGhkYmNkZWZnaGk@redis-12345.upstash.io:6379
```

### Cách 2: Parse URL thành các biến riêng (Không khuyến nghị)

Nếu muốn dùng các biến riêng, parse URL:

- Host: `your-host.upstash.io`
- Port: `6379` (hoặc port từ URL)
- Password: `your-password`

```env
REDIS_HOST=your-host.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your-password
```

## Bước 4: Verify Connection

Sau khi set environment variable, restart backend và kiểm tra logs:

```bash
# Local development
npm run start:dev

# Production (Render)
# Restart service từ Render dashboard
```

Bạn sẽ thấy log:

```
RedisModule initialized with 3 clients.
Redis Pub/Sub Subscriber is ready.
```

## 🔍 Troubleshooting

### Lỗi: "Invalid REDIS_URL format"

- ✅ Kiểm tra URL có đúng format: `redis://default:password@host:port`
- ✅ Kiểm tra không có space hoặc ký tự đặc biệt
- ✅ Đảm bảo copy đầy đủ URL từ Upstash dashboard

### Lỗi: "Connection refused" hoặc "ECONNREFUSED"

- ✅ Kiểm tra Upstash database đã được tạo và active
- ✅ Kiểm tra region của Upstash database
- ✅ Kiểm tra firewall/network settings

### Lỗi: "NOAUTH Authentication required"

- ✅ Kiểm tra password trong URL đúng
- ✅ Upstash URL có format: `redis://default:PASSWORD@host:port`
- ✅ Đảm bảo không có space trong password

### Connection timeout

- ✅ Kiểm tra network có thể truy cập Upstash
- ✅ Kiểm tra region của Upstash database (nên chọn gần server)
- ✅ Upstash free tier có rate limit, kiểm tra quota

## 📊 Upstash Free Tier Limits

- **10,000 requests/ngày** (Redis commands)
- **256 MB storage**
- **10 databases**
- **Global deployment** (multi-region)

## 💰 Upgrade (Nếu cần)

Nếu cần nhiều requests hơn:

- **Pay-as-you-go**: $0.20 per 100K requests
- **Growth**: $10/tháng cho 500K requests/ngày

## ✅ Checklist

- [ ] Tạo Upstash Redis database
- [ ] Copy Redis URL (không phải REST URL)
- [ ] Thêm `REDIS_URL` vào environment variables
- [ ] Restart backend service
- [ ] Kiểm tra logs không có lỗi connection
- [ ] Test Redis operations (orderbook, pub/sub, etc.)

## 📝 Notes

1. **Upstash hỗ trợ SSL/TLS**: URL mặc định đã dùng SSL
2. **Database number**: Upstash không dùng database number, code tự động set `db: 0`
3. **Password**: Luôn có trong URL, không cần set riêng
4. **Connection pooling**: ioredis tự động quản lý connection pool
