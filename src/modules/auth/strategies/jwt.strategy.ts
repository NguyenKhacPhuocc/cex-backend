/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { UserRole } from 'src/modules/users/entities/user.entity';
import { Request } from 'express';

export interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
}

// Custom extractor: Lấy token từ cookie HOẶC Authorization header (backward compatible)
const cookieExtractor = (req: Request): string | null => {
  let token = null;

  // Priority 1: Lấy từ cookie (secure)
  if (req && req.cookies) {
    token = req.cookies['accessToken'];
  }

  // Priority 2: Fallback to Authorization header (for backward compatibility)
  if (!token && req.headers.authorization) {
    const bearerToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (bearerToken) {
      token = bearerToken;
    }
  }

  return token;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    const options: StrategyOptions = {
      secretOrKey: process.env.JWT_ACCESS_SECRET,
      jwtFromRequest: cookieExtractor,
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
