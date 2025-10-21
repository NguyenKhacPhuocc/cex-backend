import { BaseEntity, DeleteDateColumn } from 'typeorm';

// core/database/entities/soft-delete.entity.ts
export abstract class SoftDeleteEntity extends BaseEntity {
  @DeleteDateColumn()
  deletedAt: Date | null;
}
