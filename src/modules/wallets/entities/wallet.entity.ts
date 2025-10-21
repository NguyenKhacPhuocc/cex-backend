import { User } from 'src/modules/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { LedgerEntry } from '../../ledger/entities/ledger.entity';
import { Transaction } from 'src/modules/transactions/entities/transaction.entity';

export enum WalletType {
  SPOT = 'spot',
  FUNDING = 'funding',
  FUTURES = 'futures',
}

@Entity('wallets')
@Unique(['user', 'currency', 'walletType'])
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  currency: string;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  available: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  frozen: number;

  @Column({ type: 'enum', enum: WalletType, default: WalletType.SPOT })
  walletType: WalletType;

  @OneToMany(() => Transaction, (tx) => tx.wallet)
  transactions: Transaction[];

  @OneToMany(() => LedgerEntry, (ledger) => ledger.wallet)
  ledgers: LedgerEntry[];
}
