import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { UserProfile } from './user-profile.entity';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';
import { LedgerEntry } from 'src/modules/ledger/entities/ledger.entity';
import { Order } from 'src/modules/order/entities/order.entity';
import { Transaction } from 'src/modules/transactions/entities/transaction.entity';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile: UserProfile;

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets: Wallet[];

  @OneToMany(() => Transaction, (tx) => tx.user)
  transactions: Transaction[];

  @OneToMany(() => LedgerEntry, (ledger) => ledger.user)
  ledgers: LedgerEntry[];

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];
}
