import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { env } from 'process';
import { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { ExcludePasswordInterceptor } from './common/interceptors/exclude-password.interceptor';
import cookieParser from 'cookie-parser';

// Helper function to normalize and validate origin URLs
function getCorsOrigins(): string[] {
  const origins: string[] = [];

  // Add localhost for development
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000');
  }

  // Parse FRONTEND_URL - support multiple URLs separated by comma
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    const urls = frontendUrl.split(',').map((url) => url.trim());

    for (const url of urls) {
      if (!url) continue;

      // Add https:// if missing protocol
      let normalizedUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        normalizedUrl = `https://${url}`;
      }

      origins.push(normalizedUrl);
    }
  }

  // If no origins specified, allow localhost
  if (origins.length === 0) {
    origins.push('http://localhost:3000');
  }

  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable cookie parser - QUAN TRỌNG để đọc/set cookies!
  app.use(cookieParser());

  // Get normalized CORS origins
  const corsOrigins = getCorsOrigins();
  console.log('CORS allowed origins:', corsOrigins);

  // Enable CORS với cấu hình đầy đủ
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list
      if (
        corsOrigins.some((allowedOrigin) => {
          // Exact match
          if (origin === allowedOrigin) return true;
          // Match without protocol (for flexibility)
          const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
          const allowedWithoutProtocol = allowedOrigin.replace(/^https?:\/\//, '');
          return originWithoutProtocol === allowedWithoutProtocol;
        })
      ) {
        callback(null, true);
      } else {
        console.warn('CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // Cho phép gửi cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
  });

  // Use global validation pipe
  app.useGlobalPipes(new ValidationPipe());

  // Apply custom throttler exception filter for friendly error messages
  app.useGlobalFilters(new ThrottlerExceptionFilter());

  // 🔐 SECURITY: Tự động loại bỏ password/passwordHash khỏi mọi responses
  app.useGlobalInterceptors(new ExcludePasswordInterceptor());

  // tất cả route có tiền tố /api
  app.setGlobalPrefix('api');

  // Kiểm tra kết nối database
  try {
    const dataSource = app.get<DataSource>(DataSource); // Sử dụng DI để lấy DataSource
    if (dataSource.isInitialized) {
      console.log('Kết nối cơ sở dữ liệu thành công!');
    } else {
      await dataSource.initialize();
      console.log('Kết nối cơ sở dữ liệu thành công!');
    }
  } catch (error) {
    console.error('Lỗi khi kết nối cơ sở dữ liệu:', error);
    process.exit(1);
  }

  const configService = app.get(ConfigService);
  const port = env.PORT || configService.get<number>('port') || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Error during bootstrap', err);
  process.exit(1);
});
