import { DataSource, Repository } from 'typeorm';
import { Wallet } from '../entities/wallet.entity';
import { Injectable } from '@nestjs/common';

@Injectable()
export class WalletRepository extends Repository<Wallet> {
  constructor(dataSource: DataSource) {
    super(Wallet, dataSource.createEntityManager());
  }
}
