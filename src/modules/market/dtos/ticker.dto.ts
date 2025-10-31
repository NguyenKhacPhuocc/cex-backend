export class TickerDto {
  symbol: string; // "BTC_USDT"
  pair: string; // "BTC/USDT" (format cho frontend)
  price: number; // Giá khớp gần nhất
  change24h: number; // % thay đổi 24h
  volume24h: number; // Volume 24h
  high24h?: number; // Giá cao nhất 24h (optional)
  low24h?: number; // Giá thấp nhất 24h (optional)
}
