import { Market } from 'src/modules/market/entities/market.entity';
import { Order } from 'src/modules/order/entities/order.entity';
import { User } from 'src/modules/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @ManyToOne(() => Market, (market) => market.trades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'market_id' })
  market: Market;

  @ManyToOne(() => Order, (order) => order.buyTrades)
  @JoinColumn({ name: 'buy_order_id' })
  buyOrder: Order;

  @ManyToOne(() => Order, (order) => order.sellTrades)
  @JoinColumn({ name: 'sell_order_id' })
  sellOrder: Order;

  @Column('decimal', { precision: 20, scale: 8 })
  price: number;

  @Column('decimal', { precision: 20, scale: 8 })
  amount: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  fee: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @CreateDateColumn()
  timestamp: Date;
}
