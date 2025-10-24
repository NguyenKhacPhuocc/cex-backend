CREATE TABLE public.wallets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    currency character varying NOT NULL,
    balance numeric(20,8) DEFAULT '0'::numeric NOT NULL,
    available numeric(20,8) DEFAULT '0'::numeric NOT NULL,
    frozen numeric(20,8) DEFAULT '0'::numeric NOT NULL,
    "walletType" public.wallets_wallettype_enum DEFAULT 'spot'::public.wallets_wallettype_enum NOT NULL,
    user_id uuid
);

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying NOT NULL,
    "passwordHash" character varying NOT NULL,
    role public.users_role_enum DEFAULT 'user'::public.users_role_enum NOT NULL,
    status public.users_status_enum DEFAULT 'active'::public.users_status_enum NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.user_profiles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    country character varying,
    phone character varying,
    "kycLevel" integer DEFAULT 0 NOT NULL,
    "avatarUrl" character varying,
    user_id uuid
);


CREATE TABLE public.transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    type public.transactions_type_enum NOT NULL,
    amount numeric(20,8) NOT NULL,
    currency character varying NOT NULL,
    "txHash" character varying,
    status public.transactions_status_enum DEFAULT 'completed'::public.transactions_status_enum NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    user_id uuid,
    wallet_id uuid
);


CREATE TABLE public.trades (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    price numeric(20,8) NOT NULL,
    amount numeric(20,8) NOT NULL,
    fee numeric(20,8) DEFAULT '0'::numeric NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    market_id uuid,
    buy_order_id uuid,
    sell_order_id uuid
);


CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    side character varying NOT NULL,
    type character varying DEFAULT 'limit'::character varying NOT NULL,
    price numeric(20,8),
    amount numeric(20,8) NOT NULL,
    filled numeric(20,8) DEFAULT '0'::numeric NOT NULL,
    status character varying DEFAULT 'open'::character varying NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    user_id uuid,
    market_id uuid
);


CREATE TABLE public.markets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    symbol character varying NOT NULL,
    "baseAsset" character varying NOT NULL,
    "quoteAsset" character varying NOT NULL,
    status public.markets_status_enum DEFAULT 'active'::public.markets_status_enum NOT NULL,
    "minOrderSize" numeric(20,8) DEFAULT 0.0001 NOT NULL,
    "pricePrecision" integer DEFAULT 2 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


CREATE TABLE public.ledger_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    currency character varying NOT NULL,
    "changeAmount" numeric(20,8) NOT NULL,
    "balanceBefore" numeric(20,8) NOT NULL,
    "balanceAfter" numeric(20,8) NOT NULL,
    "referenceType" public.ledger_entries_referencetype_enum NOT NULL,
    "referenceId" integer,
    description character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    user_id uuid,
    wallet_id uuid
);


1. users

Chứa thông tin tài khoản người dùng cơ bản.

👉 Tác dụng: Là bảng gốc của toàn hệ thống, quản lý tài khoản người dùng.

2. user_profiles

Chứa thông tin hồ sơ bổ sung cho người dùng.

👉 Tác dụng: Quản lý KYC (Know Your Customer) – rất quan trọng trong CEX để đáp ứng quy định AML/KYC.

3. wallets

Lưu thông tin ví của người dùng.

👉 Tác dụng: Theo dõi tài sản của từng người dùng trên từng loại ví và từng loại tiền tệ.

4. markets

Thông tin về các cặp giao dịch.

👉 Tác dụng: Định nghĩa các thị trường giao dịch trên sàn (Spot market, Futures market...).

5. orders

Lưu lệnh đặt mua/bán.

👉 Tác dụng: Hệ thống đặt lệnh (Order System). Đây là trung tâm của giao dịch spot/futures.

6. trades

Lưu chi tiết giao dịch khớp lệnh.

👉 Tác dụng: Lưu lại lịch sử khớp lệnh, dùng cho báo cáo và biểu đồ giao dịch.

7. transactions

Lưu các giao dịch nạp/rút (deposit/withdraw).

👉 Tác dụng: Ghi nhận các giao dịch nạp/rút on-chain hoặc nội bộ.

8. ledger_entries

Nhật ký sổ cái kế toán.

👉 Tác dụng: Dùng để ghi lại toàn bộ thay đổi số dư (hệ thống kế toán minh bạch).

🔧 Ví dụ minh họa:

User rút 100 USDT từ ví Funding.

transactions

id	    |type	    |amount	    |currency	    |status

1	    |withdraw	|100USDT    |USDT	        |completed

ledger_entries

id	    changeAmount	    balanceBefore	    balanceAfter	    referenceType	    referenceId

10	    -100	            500	                400	                transaction	        1

→ ledger_entries ghi rõ “tiền trong ví giảm 100”, trong khi transactions chỉ ghi “có một lệnh rút 100USDT đã hoàn tất”.







người dùng bán 0.1btc với giá 100000usdt để lấy về usdt thì sẽ khóa 0.1btc của ví đó( ví spot - currency: btc)

người dùng mua 0.1btc với giá 100000usdt để lấy về btc thì sẽ phải khóa 10000usdt trong ví (ví spot - currency: usdt)



trade price = 64000 đặt lệnh mua/ bán với giá 64000
trade value =  64000 * số lượng khớp 
ví dụ với trường hợp
1 người đặt lệnh mua 0.1 btc với giá 64000 usdt tự khóa ví spot 6400usdt và 1 người đặt lệnh bán 0.1btc với giá 64000usdt tự khóa ví spot 0.1btc thì khi đó trade value sẽ là 6400usdt tức là đây là số tiền mà thằng mua sẽ phải bỏ ra để mua 0.1 btc từ người bán 



makerOrder: Order, // người đặt lệnh trước
{
    "userId": "25ff4944-b268-498a-a3e2-d95f9e06e1f6",
    "id": "cb485881-a8c5-4133-9ba9-f1a49d8dbf98",
    "market": {
        "id": "1bf9c758-b916-46e9-85eb-a97439793366",
        "symbol": "BTCUSDT",
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "status": "active",
        "minOrderSize": "0.00010000",
        "pricePrecision": 2,
        "createdAt": "2025-10-22T04:48:29.654Z"
    },
    "side": "buy",
    "type": "limit",
    "price": 63000,
    "amount": 0.01,
    "filled": "0.00000000",
    "status": "open",
    "createdAt": "2025-10-23T10:28:27.376Z",
    "updatedAt": "2025-10-23T10:28:27.376Z"
}

takerOrder: Order, // người đặt lệnh sau
{
    "userId": "25ff4944-b268-498a-a3e2-d95f9e06e1f6",
    "id": "001eff0d-108f-4bb8-9b9b-32a19dc7945a",
    "market": {
        "id": "1bf9c758-b916-46e9-85eb-a97439793366",
        "symbol": "BTCUSDT",
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "status": "active",
        "minOrderSize": "0.00010000",
        "pricePrecision": 2,
        "createdAt": "2025-10-22T04:48:29.654Z"
    },
    "side": "sell",
    "type": "limit",
    "price": 63000,
    "amount": 0.01,
    "filled": "0.00000000",
    "status": "open",
    "createdAt": "2025-10-23T10:29:09.443Z",
    "updatedAt": "2025-10-23T10:29:09.443Z"
}