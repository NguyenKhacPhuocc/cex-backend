import { User } from 'src/modules/users/entities/user.entity';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRANSFER = 'transfer',
  TRADE = 'trade',
  FEE = 'fee',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Wallet, (wallet) => wallet.transactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'to_wallet_id' })
  toWallet: Wallet;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column('decimal', { precision: 20, scale: 8 })
  amount: number;

  @Column()
  currency: string;

  @Column({ nullable: true })
  txHash: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.COMPLETED,
  })
  status: TransactionStatus;

  @CreateDateColumn()
  createdAt: Date;
}
