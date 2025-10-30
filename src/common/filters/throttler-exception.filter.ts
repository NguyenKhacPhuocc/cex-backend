/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const status = HttpStatus.TOO_MANY_REQUESTS;

    // Custom error message in Vietnamese
    response.status(status).json({
      statusCode: status,
      message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
      error: 'Too Many Requests',
      timestamp: new Date().toISOString(),
      path: request.url,
      retryAfter: '60 seconds', // Suggest retry time
    });
  }
}
