import { Market } from 'src/modules/market/entities/market.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum Timeframe {
  ONE_SECOND = '1s',
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  THIRTY_MINUTES = '30m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w',
}

@Entity('candles')
@Index(['symbol', 'timeframe', 'timestamp'])
export class Candle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string; // BTC_USDT

  @Column({ type: 'enum', enum: Timeframe })
  timeframe: Timeframe;

  @Column('decimal', { precision: 20, scale: 8 })
  open: number;

  @Column('decimal', { precision: 20, scale: 8 })
  high: number;

  @Column('decimal', { precision: 20, scale: 8 })
  low: number;

  @Column('decimal', { precision: 20, scale: 8 })
  close: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  volume: number;

  @Column('timestamp')
  timestamp: Date;

  @ManyToOne(() => Market, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'market_id' })
  market: Market;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
