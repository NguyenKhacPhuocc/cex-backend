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
  timestamp: Date;
  counterparty: CounterpartyDto;
}
