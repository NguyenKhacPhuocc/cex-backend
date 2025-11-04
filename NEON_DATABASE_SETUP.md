# 🗄️ Hướng Dẫn Kết Nối Neon PostgreSQL

## Bước 1: Tạo Database trên Neon

1. Đăng ký tại https://neon.tech
2. Click "Create Project"
3. Đặt tên project và chọn region
4. Neon tự động tạo database và cung cấp connection string

## Bước 2: Copy Connection String

Neon cung cấp connection string dạng:

```
postgresql://neondb_owner:npg_62GcDEyOYMUq@ep-square-cloud-aea6tjsx-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require
```

**Format breakdown:**

- `postgresql://` - Protocol
- `neondb_owner` - Username
- `npg_62GcDEyOYMUq` - Password
- `ep-square-cloud-aea6tjsx-pooler.c-2.us-east-2.aws.neon.tech` - Host
- `neondb` - Database name
- `?sslmode=require` - SSL requirement (quan trọng!)

## Bước 3: Cấu Hình trong Project

### Cách 1: Dùng DATABASE_URL trực tiếp (Khuyến nghị)

Thêm vào file `.env` hoặc environment variables trên Render:

```env
DATABASE_URL=postgresql://neondb_owner:npg_62GcDEyOYMUq@ep-square-cloud-aea6tjsx-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require
```

**Lưu ý:**

- ✅ Copy toàn bộ URL từ Neon dashboard
- ✅ Giữ nguyên `?sslmode=require` ở cuối
- ✅ Code tự động detect `sslmode=require` và bật SSL

### Cách 2: Parse URL thành các biến riêng (Không khuyến nghị)

Nếu muốn dùng các biến riêng, parse URL:

- Host: `ep-square-cloud-aea6tjsx-pooler.c-2.us-east-2.aws.neon.tech`
- Port: `5432` (mặc định, có thể không có trong URL)
- Username: `neondb_owner`
- Password: `npg_62GcDEyOYMUq`
- Database: `neondb`

```env
DB_HOST=ep-square-cloud-aea6tjsx-pooler.c-2.us-east-2.aws.neon.tech
DB_PORT=5432
DB_USERNAME=neondb_owner
DB_PASSWORD=npg_62GcDEyOYMUq
DB_DATABASE=neondb
```

Nhưng cách này sẽ không tự động bật SSL, nên không khuyến nghị.

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
Kết nối cơ sở dữ liệu thành công!
Application is running on: http://localhost:8000
```

## 🔍 Troubleshooting

### Lỗi: "Invalid DATABASE_URL format"

- ✅ Kiểm tra URL có đúng format: `postgresql://user:password@host/db?sslmode=require`
- ✅ Kiểm tra không có space hoặc ký tự đặc biệt
- ✅ Đảm bảo copy đầy đủ URL từ Neon dashboard

### Lỗi: "Connection refused" hoặc "ECONNREFUSED"

- ✅ Kiểm tra Neon database đã được tạo và active
- ✅ Kiểm tra region của Neon database
- ✅ Kiểm tra firewall/network settings
- ✅ Kiểm tra có đúng port không (mặc định 5432)

### Lỗi: "SSL connection required"

- ✅ Đảm bảo URL có `?sslmode=require` ở cuối
- ✅ Code tự động detect và bật SSL nếu có `sslmode=require`
- ✅ Nếu vẫn lỗi, kiểm tra `database-config.ts` có bật SSL không

### Connection timeout

- ✅ Kiểm tra network có thể truy cập Neon
- ✅ Kiểm tra region của Neon database (nên chọn gần server)
- ✅ Neon có connection pooling, đảm bảo dùng đúng endpoint

## 📊 Neon Free Tier Limits

- **0.5 GB storage**
- **Compute time**: Generous free tier
- **Branches**: Unlimited
- **Projects**: Unlimited
- **Connection pooling**: Included

## 💰 Upgrade (Nếu cần)

Nếu cần nhiều storage hoặc compute hơn:

- **Launch**: $19/tháng cho 10 GB storage
- **Scale**: $69/tháng cho 50 GB storage

## ⚠️ Lưu ý về Neon Connection Strings

Neon cung cấp 2 loại connection string:

1. **Direct connection** (không có pooler):

   ```
   postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```

2. **Pooler connection** (có pooler, khuyến nghị):
   ```
   postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```

**Khuyến nghị:** Dùng pooler connection cho production (xử lý nhiều connections tốt hơn).

## ✅ Checklist

- [ ] Tạo Neon project và database
- [ ] Copy connection string (với `?sslmode=require`)
- [ ] Thêm `DATABASE_URL` vào environment variables
- [ ] Restart backend service
- [ ] Kiểm tra logs không có lỗi connection
- [ ] Test database operations (tạo user, query, etc.)

## 📝 Notes

1. **SSL/TLS**: Neon yêu cầu SSL, nên luôn có `?sslmode=require` trong URL
2. **Connection pooling**: Neon có pooler để quản lý connections tốt hơn
3. **Port**: Mặc định 5432, có thể không có trong URL (code tự động dùng 5432)
4. **Auto SSL detection**: Code tự động detect `sslmode=require` và bật SSL
