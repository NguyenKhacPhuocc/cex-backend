/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom Throttler Guard that skips rate limiting for specific endpoints
 * while protecting all others (auth, orders, etc.)
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const url = request.url as string;

    // Skip throttling for balance endpoints (read-only, need real-time updates)
    if (url.startsWith('/api/balances')) {
      return true;
    }

    // Skip throttling for market data endpoints (public, high-frequency reads)
    if (url.startsWith('/api/market') && request.method === 'GET') {
      return true;
    }

    // Apply throttling to all other endpoints (auth, orders, etc.)
    return false;
  }
}
