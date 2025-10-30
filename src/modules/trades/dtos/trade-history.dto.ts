export class CounterpartyDto {
  id: string;
  type: 'BUYER' | 'SELLER';
}

export class TradeHistoryDto {
  id: number;
  market: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  total: string;
  fee: number;
  timestamp: string; // ISO 8601 string format
  counterparty: CounterpartyDto;
}
