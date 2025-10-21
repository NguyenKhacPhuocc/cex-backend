/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      throw err || new ForbiddenException('Authentication required');
    }

    // Check if user is active
    if (user.status && user.status !== 'active') {
      throw new ForbiddenException('Account is suspended');
    }

    // Check if user has admin role
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    return user;
  }
}
