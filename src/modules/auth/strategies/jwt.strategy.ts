/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { UserRole } from 'src/modules/users/entities/user.entity';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

// Custom extractor: Extract token from cookie OR Authorization header (backward compatible)

const cookieExtractor = (req: Request): string | null => {
  let token: string | null = null;

  // Priority 1: Get from cookie (secure)
  if (req?.cookies && typeof req.cookies === 'object') {
    token = (req.cookies as Record<string, string>)['accessToken'] ?? null;
  }

  // Priority 2: Fallback to Authorization header (for backward compatibility)
  if (!token && req?.headers?.authorization) {
    try {
      const bearerExtractor = ExtractJwt.fromAuthHeaderAsBearerToken();
      const bearerToken = bearerExtractor(req);
      if (bearerToken && typeof bearerToken === 'string') {
        token = bearerToken;
      }
    } catch {
      // Silent fail, no bearer token found
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

  validate(payload: JwtPayload): { id: string; email: string; role: UserRole } {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
