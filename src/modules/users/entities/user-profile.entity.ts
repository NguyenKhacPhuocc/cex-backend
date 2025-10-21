import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ default: 0 })
  kycLevel: number;

  @Column({ nullable: true })
  avatarUrl: string;
}
