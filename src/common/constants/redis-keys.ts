export const REDIS_KEYS = {
  ORDER_BOOK: (pair: string) => `orderbook:${pair}`,
  TRADE_FEED: (pair: string) => `trade:${pair}`,
  RATE_LIMIT: (userId: string) => `ratelimit:${userId}`,
  ORDER_QUEUE: 'orderQueue',
  USER_OPEN_ORDERS: (userId: number) => `user:${userId}:open-orders`,
  ORDER_UPDATE_CHANNEL: 'order_update_channel',
};
