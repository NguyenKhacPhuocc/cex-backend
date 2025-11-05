export const REDIS_KEYS = {
  ORDER_BOOK: (pair: string) => `orderbook:${pair}`,
  TRADE_FEED: (pair: string) => `trade:${pair}`,
  RATE_LIMIT: (userId: string) => `ratelimit:${userId}`,
  ORDER_QUEUE: 'orderQueue',
  USER_OPEN_ORDERS: (userId: string) => `user:${userId}:open-orders`,
  ORDER_UPDATE_CHANNEL: 'orderbook:update',
  ORDER_CANCEL_CHANNEL: 'order:cancel',
};
