Đây là cấu trúc thư mục back-end NestJS đầy đủ, được tinh chỉnh tối đa cho một sàn giao dịch CEX mini, đảm bảo tính đóng gói, khả năng mở rộng, và tuân thủ các nguyên tắc thiết kế hiện đại.

-----

## Cấu trúc thư mục Back-end NestJS (Sàn CEX mini)

```
/backend
├── node_modules/
├── dist/                          # (Tự động tạo) Chứa code đã build (JavaScript)
├── .env.development               # Biến môi trường cho môi trường dev
├── .env.production                # Biến môi trường cho môi trường prod
├── package.json
├── nest-cli.json
├── tsconfig.json
│
├── src/
│   ├── main.ts                    # Entry Point: Khởi tạo ứng dụng (NestFactory.create), áp dụng global Pipes/Filters.
│   ├── app.module.ts              # Root Module: Import các Core/Shared Modules và tất cả Feature Modules.
│
│   ├── common/                    # Các thành phần KỸ THUẬT dùng chung (Cross-cutting Concerns)
│   │   ├── constants/
│   │   │   ├── redis-keys.ts      # Các key định danh Redis (vd: ORDERBOOK_BTCUSDT)
│   │   │   ├── order-status.ts    # Enum/Constants cho trạng thái Order (vd: PENDING, FILLED)
│   │   │   └── pair-list.ts       # Danh sách cặp giao dịch được hỗ trợ (vd: BTC/USDT)
│   │   ├── decorators/            # Custom Decorators (@GetUser, @Public)
│   │   ├── dtos/                  # DTOs CHUNG (vd: PaginationDto, SuccessResponseDto)
│   │   ├── filters/               # Global Exception Filters (vd: AllExceptionsFilter)
│   │   ├── guards/                # Global Guards (vd: ThrottlerGuard, ApiKeyGuard)
│   │   ├── interceptors/          # Global Interceptors (vd: LoggingInterceptor, TransformInterceptor)
│   │   └── utils/
│   │       ├── math.util.ts       # Xử lý số lượng, rounding, precision (vd: normalizeAmount)
│   │       └── time.util.ts       # Xử lý thời gian, format timestamp (vd: getStartTimeOfToday)
│
│   ├── core/                      # Các Module HẠ TẦNG (Core Infrastructure)
│   │   ├── config/                # Quản lý cấu hình (@nestjs/config)
│   │   │   ├── config.module.ts
│   │   │   └── configuration.ts   # Hàm load config từ .env
│   │   ├── database/              # TypeORM/Prisma Module
│   │   │   ├── database.module.ts # Thiết lập kết nối
│   │   │   ├── entities/          # Entities nền tảng (vd: BaseEntity, TimestampEntity)
│   │   │   ├── migrations/
│   │   │   └── seeds/
│   │   └── redis/                 # Redis Module
│   │       ├── redis.module.ts
│   │       ├── redis.service.ts   # Redis Client và các helper (SET, GET)
│   │       └── redis.pubsub.ts    # Service chuyên dụng cho Pub/Sub (Trade/Orderbook events)
│   │
│   └── modules/                   # Các Module NGHIỆP VỤ (Feature Modules)
│       ├── auth/                  # Xác thực người dùng
│       │   ├── dtos/              # (LoginDto, RegisterDto)
│       │   ├── guards/            # (JwtAuthGuard)
│       │   ├── strategies/        # (JwtStrategy, LocalStrategy)
│       │   ├── auth.controller.ts # Route: /auth/login, /auth/register
│       │   ├── auth.module.ts
│       │   └── auth.service.ts
│       │
│       ├── users/                 # Quản lý User Profile, KYC
│       │   ├── dtos/              # (UpdateProfileDto, KycDto)
│       │   ├── entities/          # (user.entity.ts, kyc-document.entity.ts)
│       │   ├── repositories/      # (user.repository.ts)
│       │   ├── users.controller.ts# Route: /users/profile
│       │   ├── users.module.ts
│       │   └── users.service.ts
│       │
│       ├── trading/               # LÕI: Đặt lệnh và Quản lý lệnh
│       │   ├── dtos/              # (CreateOrderDto, CancelOrderDto)
│       │   ├── entities/          # (order.entity.ts)
│       │   ├── repositories/      # (order.repository.ts)
│       │   ├── trading.module.ts
│       │   ├── trading.controller.ts # Route: /trading/order (REST API)
│       │   ├── trading.gateway.ts # WebSocket: Xử lý kết nối, nhận lệnh qua WS
│       │   ├── trading.service.ts # Logic nghiệp vụ (Kiểm tra số dư, xác thực lệnh)
│       │   ├── order-book.service.ts # Logic quản lý Order Book (thường dùng Redis/bộ nhớ)
│       │   └── order-queue-consumer.service.ts # Worker tiêu thụ lệnh từ Queue
│       │
│       ├── market/                # Dữ liệu thị trường (Market Data)
│       │   ├── dtos/              # (KlinesQueryDto)
│       │   ├── entities/          # (symbol-info.entity.ts)
│       │   ├── repositories/
│       │   ├── market.module.ts
│       │   ├── market.controller.ts # Route: /market/klines, /market/ticker/24h
│       │   ├── market.gateway.ts    # WebSocket: Gửi dữ liệu thị trường chung
│       │   ├── market.service.ts    # Lấy giá, tính toán volume/24h
│       │   └── market-cache.service.ts # Cache dữ liệu thị trường (ví dụ: giá mới nhất)
│       │
│       ├── wallets/               # Ví và Giao dịch tài sản (Nạp/Rút/Chuyển khoản)
│       │   ├── dtos/
│       │   ├── entities/          # (wallet.entity.ts, transaction.entity.ts)
│       │   ├── repositories/
│       │   ├── wallets.module.ts
│       │   ├── wallets.controller.ts # Route: /wallets/balance, /wallets/deposit
│       │   └── wallets.service.ts
│       │
│       └── trades/                # Lịch sử khớp lệnh (thường được tách khỏi trading/ để giảm tải)
│           ├── dtos/
│           ├── entities/          # (trade.entity.ts)
│           ├── repositories/
│           ├── trades.module.ts
│           ├── trades.controller.ts # Route: /trades/history
│           ├── trades.gateway.ts    # WebSocket: Gửi thông báo Trade mới
│           └── trades.service.ts
│
├── test/
│   ├── e2e/
│   └── unit/
```