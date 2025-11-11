import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

/**
 * Limit Order Bot Strategy
 * 70% of bots use this strategy
 * Places limit orders around average price ± spread (0.1-0.5%)
 */
export class LimitOrderBotStrategy extends BaseStrategy {
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

    // Prevent too frequent orders
    // Spread nhỏ hơn (0.05% - 0.2%) để giống Binance, tránh giá cao đột xuất
    const spreadPercent = Math.random() * 0.0004 + 0.0001; // 0.01% - 0.05%

    // Random side
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;

    // Chỉ dùng để tạo nhiều mức giá khác nhau, không làm giá lệch quá xa
    // Variation phải đảm bảo BUY luôn thấp hơn, SELL luôn cao hơn average
    // const priceVariation = (Math.random() - 0.5) * 0.0001; // ±0.005% variation (nhỏ hơn)

    // Calculate price around average price ± spread với variation
    let price: number;
    if (side === OrderSide.BUY) {
      // Buy below average price
      price = this.averagePrice * (1 - spreadPercent);
    } else {
      // Sell above average price
      price = this.averagePrice * (1 + spreadPercent);
    }

    // Safety limit: giá không được lệch quá ±0.5% so với average price
    const maxPrice = this.averagePrice * 1.001; // +0.1%
    const minPrice = this.averagePrice * 0.999; // -0.1%
    price = Math.max(minPrice, Math.min(maxPrice, price));

    // Round price với 5 decimal để tạo nhiều mức giá khác nhau
    // Round price với precision từ marketInfo
    const decimals = this.marketInfo?.pricePrecision || 5;
    price = this.roundPrice(price, decimals);

    // Dynamic amount based on market minOrderSize
    let minAmount = 0.001;
    let maxAmount = 0.05;

    if (this.marketInfo) {
      // Use 10x to 100x minOrderSize for reasonable order serializedOrders
      minAmount = Number(this.marketInfo.minOrderSize) * 20;
      maxAmount = Number(this.marketInfo.minOrderSize) * 200;

      // Ensure minimum viable order size
      if (minAmount < 0.001) minAmount = 0.001;
      if (maxAmount < 0.01) maxAmount = 0.01;
    }

    const amount = this.getRandomAmount(minAmount, maxAmount);

    return {
      side,
      price: price,
      amount: this.roundAmount(amount),
    };
  }

  getInterval(): number {
    // Random interval between 10-30 seconds (10000-30000ms) - faster for more active trading
    return Math.floor(Math.random() * 90000) + 30000; // 30000-90000ms
  }
}
