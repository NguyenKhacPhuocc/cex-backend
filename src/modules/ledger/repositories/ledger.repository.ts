import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { LedgerEntry } from '../entities/ledger.entity';

@Injectable()
export class LedgerRepository extends Repository<LedgerEntry> {
  constructor(dataSource: DataSource) {
    super(LedgerEntry, dataSource.createEntityManager());
  }
}
