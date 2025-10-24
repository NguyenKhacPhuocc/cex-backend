import { User } from 'src/modules/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Wallet } from '../../wallets/entities/wallet.entity';

export enum LedgerReferenceType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRADE_SELL = 'trade_sell',
  TRADE_BUY = 'trade_buy',
  TRANSFER = 'transfer',
  FEE = 'fee',
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.ledgers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Wallet, (wallet) => wallet.ledgers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @Column()
  currency: string;

  @Column('decimal', { precision: 20, scale: 8 })
  changeAmount: number;

  @Column('decimal', { precision: 20, scale: 8 })
  balanceBefore: number;

  @Column('decimal', { precision: 20, scale: 8 })
  balanceAfter: number;

  @Column({ type: 'enum', enum: LedgerReferenceType })
  referenceType: LedgerReferenceType;

  @Column({ nullable: true })
  referenceId: string;

  @Column({ nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
