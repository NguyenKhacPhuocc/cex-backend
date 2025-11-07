import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

/**
 * Limit Order Bot Strategy
 * 70% of bots use this strategy
 * Places limit orders around average price ± spread (0.1-0.5%)
 */
export class LimitOrderBotStrategy extends BaseStrategy {
  private lastOrderTime: number = 0;
  private averagePrice: number = 0;
  private lastAveragePrice: number = 0;
  private activeOrderPrice: number = 0; // Track the price of the active limit order
  private activeOrderSide: OrderSide | null = null;

  constructor(symbol: string) {
    super(symbol);
  }

  onPriceUpdate(ticker: TickerData): void {
    if (ticker.symbol === this.symbol) {
      this.lastPrice = ticker.price;
      this.addToHistory(ticker.price);

      // Update average price (using Binance price as reference)
      this.averagePrice = ticker.price;
    }
  }

  /**
   * Set the average price from Binance reference
   */
  setAveragePrice(price: number): void {
    this.averagePrice = price;
    this.lastPrice = price;
  }

  /**
   * Check if average price changed > 1%
   * Returns true if price change is significant enough to cancel and replace order
   */
  shouldCancelAndReplace(): boolean {
    if (this.lastAveragePrice === 0 || this.averagePrice === 0) {
      return false;
    }

    const priceChangePercent = Math.abs(
      (this.averagePrice - this.lastAveragePrice) / this.lastAveragePrice,
    );

    // Cancel and replace if price changed > 1%
    return priceChangePercent > 0.01;
  }

  /**
   * Get the price of the active limit order (if any)
   */
  getActiveOrderPrice(): number {
    return this.activeOrderPrice;
  }

  /**
   * Get the side of the active limit order (if any)
   */
  getActiveOrderSide(): OrderSide | null {
    return this.activeOrderSide;
  }

  /**
   * Set active order info (called after placing order)
   */
  setActiveOrder(price: number, side: OrderSide): void {
    this.activeOrderPrice = price;
    this.activeOrderSide = side;
    this.lastAveragePrice = this.averagePrice;
  }

  /**
   * Clear active order info (called after canceling order)
   */
  clearActiveOrder(): void {
    this.activeOrderPrice = 0;
    this.activeOrderSide = null;
  }

  getAction(): Action | null {
    if (this.averagePrice === 0) return null;

    const now = Date.now();
    const interval = this.getInterval(); // 500-2000ms

    // Prevent too frequent orders
    if (now - this.lastOrderTime < interval) {
      return null;
    }

    // Spread nhỏ hơn (0.05% - 0.2%) để giống Binance, tránh giá cao đột xuất
    const spreadPercent = Math.random() * 0.0005 + 0.0005; // 0.05% to 0.2%

    // Random side
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;

    // Variation nhỏ hơn để tránh giá lệch quá xa
    // Chỉ dùng để tạo nhiều mức giá khác nhau, không làm giá lệch quá xa
    const priceVariation = (Math.random() - 0.5) * 0.001; // ±0.05% variation (nhỏ hơn)

    // Calculate price around average price ± spread với variation
    let price: number;
    if (side === OrderSide.BUY) {
      // Buy below average price
      price = this.averagePrice * (1 - spreadPercent + priceVariation);
    } else {
      // Sell above average price
      price = this.averagePrice * (1 + spreadPercent + priceVariation);
    }

    // Giới hạn giá tối đa/tối thiểu để tránh giá cao đột xuất
    // Giá không được lệch quá ±0.5% so với average price
    const maxPrice = this.averagePrice * 1.005; // +0.5%
    const minPrice = this.averagePrice * 0.995; // -0.5%
    price = Math.max(minPrice, Math.min(maxPrice, price));

    // Round price với 5 decimal để tạo nhiều mức giá khác nhau
    // Với giá ~100k, round 5 decimal = 0.001 increment
    // Đảm bảo mỗi lệnh có giá khác nhau (không bị aggregate)
    price = this.roundPrice(price, 5);

    // Dynamic amount based on market minOrderSize
    let minAmount = 0.001;
    let maxAmount = 0.01;

    if (this.marketInfo) {
      // Use 10x to 100x minOrderSize for reasonable order sizes
      minAmount = Number(this.marketInfo.minOrderSize) * 10;
      maxAmount = Number(this.marketInfo.minOrderSize) * 100;

      // Ensure minimum viable order size
      if (minAmount < 0.001) minAmount = 0.001;
      if (maxAmount < 0.01) maxAmount = 0.01;
    }

    const amount = this.getRandomAmount(minAmount, maxAmount);

    this.lastOrderTime = now;

    return {
      side,
      // Price đã được round 4 decimal ở trên để tạo nhiều mức giá khác nhau
      price: price,
      amount: this.roundAmount(amount),
    };
  }

  getInterval(): number {
    // Random interval between 30-120 seconds (30000-120000ms) - much slower for realistic trading
    return Math.floor(Math.random() * 90000) + 30000;
  }
}
