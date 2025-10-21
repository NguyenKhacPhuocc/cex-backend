/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { UserRole } from 'src/modules/users/entities/user.entity';

export interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const options: StrategyOptions = {
      secretOrKey: process.env.JWT_ACCESS_SECRET,
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    };
    super(options);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async validate(
    payload: JwtPayload,
  ): Promise<{ id: number; email: string; role: UserRole }> {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
