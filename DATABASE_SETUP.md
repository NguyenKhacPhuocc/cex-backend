# 🗄️ Hướng Dẫn Setup Database cho Production

## ⚠️ Vấn Đề: Database chưa có tables

Khi deploy lần đầu, database thường chưa có tables. Có 2 cách để tạo tables:

## Cách 1: Tạm thời bật Synchronize (Quick Fix)

### Bước 1: Bật Synchronize trong Environment Variables

Trên Render (hoặc production environment), thêm:

```env
DB_SYNCHRONIZE=true
NODE_ENV=production
```

### Bước 2: Deploy và chờ tables được tạo

Render sẽ tự động restart và TypeORM sẽ tạo tất cả tables từ entities.

### Bước 3: Tắt Synchronize sau khi tables đã tạo

Sau khi tables đã được tạo (kiểm tra logs), **QUAN TRỌNG**: Tắt synchronize:

```env
DB_SYNCHRONIZE=false
```

**Lý do:** `synchronize: true` có thể gây mất dữ liệu nếu schema thay đổi.

---

## Cách 2: Dùng Migrations (Recommended cho Production)

### Bước 1: Tạo Migration từ Entities

```bash
cd backend
npm install typeorm -g  # hoặc dùng npx
typeorm migration:generate -n InitialSchema
```

Hoặc nếu dùng NestJS CLI:

```bash
nest g migration InitialSchema
```

### Bước 2: Chạy Migration

```bash
npm run migration:run
```

### Bước 3: Uncomment migrations config

Trong `database-config.ts`, uncomment:

```typescript
migrations: ['dist/migrations/*.js'],
migrationsRun: true,
```

---

## ✅ Checklist Setup Database

### Lần đầu deploy:

- [ ] Set `DB_SYNCHRONIZE=true` trong environment variables
- [ ] Deploy và chờ tables được tạo
- [ ] Kiểm tra logs xem có lỗi không
- [ ] Test kết nối database
- [ ] **QUAN TRỌNG**: Set `DB_SYNCHRONIZE=false` sau khi tables đã tạo
- [ ] Redeploy để áp dụng thay đổi

### Sau khi tables đã có:

- [ ] Tạo migrations cho các thay đổi schema sau này
- [ ] Dùng `migrationsRun: true` để tự động chạy migrations
- [ ] Không bao giờ dùng `synchronize: true` trong production nữa

---

## 🔍 Kiểm Tra Tables Đã Tạo

### Cách 1: Kiểm tra logs

Tìm trong logs:

```
query: CREATE TABLE "users"...
query: CREATE TABLE "wallets"...
```

### Cách 2: Kết nối database trực tiếp

```bash
# Dùng psql hoặc database client
psql $DATABASE_URL

# List tables
\dt

# Hoặc
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```

---

## 🐛 Troubleshooting

### Lỗi: "relation 'users' does not exist"

- ✅ Kiểm tra `DB_SYNCHRONIZE=true` đã set chưa
- ✅ Kiểm tra `NODE_ENV=production` đã set chưa
- ✅ Restart service sau khi set environment variables
- ✅ Kiểm tra logs xem có lỗi tạo tables không

### Lỗi: "syntax error" khi tạo tables

- ✅ Kiểm tra entities có đúng syntax không
- ✅ Kiểm tra database connection string đúng không
- ✅ Kiểm tra database có quyền tạo tables không

### Tables được tạo nhưng sau đó mất

- ✅ Kiểm tra có ai set lại `DB_SYNCHRONIZE=true` không
- ✅ Kiểm tra database có bị reset không
- ✅ Kiểm tra migrations có chạy đúng không

---

## 📝 Notes

1. **Synchronize vs Migrations**:
   - `synchronize: true`: Tự động tạo/update tables từ entities (nguy hiểm trong production)
   - Migrations: Manual control, an toàn hơn, có thể rollback

2. **Best Practice**:
   - Development: Dùng `synchronize: true` (tiện lợi)
   - Production: Dùng migrations (an toàn)

3. **Initial Setup**:
   - Có thể tạm dùng `synchronize: true` để tạo tables lần đầu
   - Sau đó tắt và dùng migrations cho các thay đổi sau

4. **TypeORM Behavior**:
   - Nếu `synchronize: true`, TypeORM sẽ tự động tạo tables khi app start
   - Nếu `synchronize: false`, cần migrations hoặc manual SQL
