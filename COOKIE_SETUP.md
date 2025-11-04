# 🍪 Cookie Configuration Guide

## Vấn Đề: Cookie không lưu được trong Production

Khi deploy frontend và backend trên các domains khác nhau (ví dụ: `vercel.app` và `onrender.com`), cookies cần được cấu hình đặc biệt để hoạt động cross-site.

## ✅ Giải Pháp

### 1. Cookie Settings cho Production

Backend đã được cấu hình tự động:

```typescript
const isProduction = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProduction, // true trong production (HTTPS required)
  sameSite: isProduction ? 'none' : 'lax', // 'none' cho cross-site, 'lax' cho same-site
  maxAge: 60 * 60 * 1000, // 1 hour
  path: '/',
};
```

### 2. CORS Configuration

Frontend phải gửi `withCredentials: true`:

```typescript
// frontend/src/lib/axios.ts
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_URL_BACKEND,
  withCredentials: true, // ✅ QUAN TRỌNG: Gửi cookies
});
```

Backend phải cho phép credentials:

```typescript
// backend/src/main.ts
app.enableCors({
  credentials: true, // ✅ Cho phép cookies
  origin: getCorsOrigins(),
});
```

### 3. Environment Variables

**Backend (Render):**

```env
NODE_ENV=production
FRONTEND_URL=https://cex-project.vercel.app
```

**Frontend (Vercel):**

```env
NEXT_PUBLIC_URL_BACKEND=https://cex-backend-ey47.onrender.com
```

## 🔍 Troubleshooting

### Cookie không được set

**Kiểm tra:**

1. ✅ Backend đã set `secure: true` và `sameSite: 'none'` trong production
2. ✅ Frontend đã set `withCredentials: true` trong axios
3. ✅ Backend CORS đã set `credentials: true`
4. ✅ Cả frontend và backend đều dùng HTTPS (không phải HTTP)

**Debug:**

- Mở DevTools → Application → Cookies
- Kiểm tra xem có cookies `accessToken` và `refreshToken` không
- Kiểm tra cookie attributes (Secure, SameSite, HttpOnly)

### Cookie bị block bởi browser

**Nguyên nhân:**

- Browser block third-party cookies (Chrome, Safari)
- `sameSite: 'none'` yêu cầu `secure: true` (HTTPS)

**Giải pháp:**

- Đảm bảo cả frontend và backend đều dùng HTTPS
- Kiểm tra browser settings (Allow third-party cookies)

### CORS Error khi gửi cookies

**Lỗi:**

```
Access-Control-Allow-Origin header contains invalid value
```

**Giải pháp:**

- Kiểm tra `FRONTEND_URL` trong backend có đúng domain không
- Đảm bảo URL có protocol (`https://`)
- Kiểm tra logs: `CORS allowed origins: [...]`

## 📝 Cookie Attributes

| Attribute  | Development | Production | Mô tả                                  |
| ---------- | ----------- | ---------- | -------------------------------------- |
| `httpOnly` | `true`      | `true`     | Không cho JavaScript access (security) |
| `secure`   | `false`     | `true`     | Chỉ gửi qua HTTPS                      |
| `sameSite` | `'lax'`     | `'none'`   | Cross-site cookies                     |
| `path`     | `'/'`       | `'/'`      | Cookie available cho tất cả paths      |
| `maxAge`   | 1 hour      | 1 hour     | Access token expiry                    |
| `maxAge`   | 30 days     | 30 days    | Refresh token expiry                   |

## ⚠️ Lưu Ý

1. **SameSite: 'none'** yêu cầu **Secure: true** (HTTPS)
2. **Cross-site cookies** có thể bị block bởi browser privacy settings
3. **Development** có thể dùng `secure: false` và `sameSite: 'lax'` cho localhost
4. **Production** phải dùng `secure: true` và `sameSite: 'none'` cho cross-site

## 🔗 References

- [MDN: SameSite Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
- [MDN: Cross-Site Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cross-site-cookies)
- [Chrome: Third-Party Cookies](https://developer.chrome.com/docs/privacy-sandbox/third-party-cookies/)
