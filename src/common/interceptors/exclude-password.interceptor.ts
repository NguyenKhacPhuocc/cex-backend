/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor để tự động loại bỏ sensitive fields (password, passwordHash)
 * khỏi tất cả responses
 */
@Injectable()
export class ExcludePasswordInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        return this.removeSensitiveFields(data);
      }),
    );
  }

  private removeSensitiveFields(data: any): any {
    if (!data) return data;

    // Nếu là array
    if (Array.isArray(data)) {
      return data.map((item) => this.removeSensitiveFields(item));
    }

    // Nếu là object
    if (typeof data === 'object') {
      const cleaned = { ...data };

      // Loại bỏ các sensitive fields
      delete cleaned.password;
      delete cleaned.passwordHash;

      // Recursively clean nested objects
      Object.keys(cleaned).forEach((key) => {
        if (typeof cleaned[key] === 'object') {
          cleaned[key] = this.removeSensitiveFields(cleaned[key]);
        }
      });

      return cleaned;
    }

    return data;
  }
}
