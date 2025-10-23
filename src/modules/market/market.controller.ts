// src/modules/wallets/wallets.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  // Lấy danh sách tất cả thị trường đang hoạt động (ví dụ: BTC/USDT, ETH/USDT)
  @Get()
  async getAllMarkets() {
    return this.marketService.findAll();
  }

  // lấy thông tin 1 cặp giao dịch
  @Get(':symbol')
  async getInfoMarket(@Param('symbol') symbol: string) {
    return this.marketService.findBySymbol(symbol);
  }

  // Lấy giá hiện tại, phần trăm thay đổi 24h, volume 24h của tất cả cặp, Dữ liệu tổng hợp từ trades hoặc Redis cache (cập nhật mỗi 3–5s).
  @Get('ticker')
  getTiker() {
    return 'getTicker';
  }

  //Lấy thông tin ticker cụ thể cho 1 cặp, Cache trong Redis, đồng bộ với trade:new event từ Redis Pub/Sub.
  @Get('ticker')
  getInfoTiker() {
    return 'getInfoTiker';
  }

  // Lấy sổ lệnh (bids/asks) hiện tại cho thị trường, Đọc từ Redis ZSET (orderbook:{symbol}:buy, orderbook:{symbol}:sell), cực nhanh.
  @Get('orderbook/:symbol')
  getOrderBookSymbol() {
    return 'getOrderBookSymbol';
  }

  // Lịch sử 50 lệnh khớp gần nhất của thị trường, Lấy từ Redis cache (recent_trades:{symbol}) hoặc DB nếu cache trống.
  @Get('trades/:symbol')
  getTradeSymbol() {
    return 'getTradeSymbol';
  }

  @Get('stats')
  getStats() {
    return 'getStats';
  }
}
