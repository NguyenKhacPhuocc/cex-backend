export const REDIS_KEYS = {
  ORDER_BOOK: (pair: string) => `orderbook:${pair}`,
  TRADE_FEED: (pair: string) => `trade:${pair}`,
  RATE_LIMIT: (userId: string) => `ratelimit:${userId}`,
  ORDER_QUEUE: 'orderQueue',
};
