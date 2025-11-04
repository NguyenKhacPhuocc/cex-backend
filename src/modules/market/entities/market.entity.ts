import { Order } from 'src/modules/order/entities/order.entity';
import { Trade } from 'src/modules/trades/entities/trade.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';

export enum MarketStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('markets')
export class Market {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @Column({ unique: true })
  symbol: string; // BTC_USDT

  @Column()
  baseAsset: string; // BTC

  @Column()
  quoteAsset: string; // USDT

  @Column({ type: 'enum', enum: MarketStatus, default: MarketStatus.ACTIVE })
  status: MarketStatus;

  @Column('decimal', { precision: 20, scale: 8, default: 0.0001 })
  minOrderSize: number;

  @Column({ default: 2 })
  pricePrecision: number;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Order, (order) => order.market)
  orders: Order[];

  @OneToMany(() => Trade, (trade) => trade.market)
  trades: Trade[];
}
