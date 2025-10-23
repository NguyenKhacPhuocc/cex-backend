import { Market } from 'src/modules/market/entities/market.entity';
import { Trade } from 'src/modules/trades/entities/trade.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { OrderSide, OrderStatus, OrderType } from 'src/shared/enums';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Market, (market) => market.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'market_id' })
  market: Market;

  // Thay enum bằng string type
  @Column({ type: 'varchar' })
  side: OrderSide;

  @Column({ type: 'varchar', default: OrderType.LIMIT })
  type: OrderType;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  price: number;

  @Column('decimal', { precision: 20, scale: 8 })
  amount: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  filled: number;

  // Thay enum bằng string type
  @Column({ type: 'varchar', default: OrderStatus.OPEN })
  status: OrderStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Trade, (trade) => trade.buyOrder)
  buyTrades: Trade[];

  @OneToMany(() => Trade, (trade) => trade.sellOrder)
  sellTrades: Trade[];
}
