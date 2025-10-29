import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { env } from 'process';
import { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable cookie parser - QUAN TRỌNG để đọc/set cookies!
  app.use(cookieParser());

  // Enable CORS với cấu hình đầy đủ
  app.enableCors({
    origin: process.env.FRONTEND_URL, // Frontend URLs
    credentials: true, // Cho phép gửi cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
  });

  // Use global validation pipe
  app.useGlobalPipes(new ValidationPipe());

  // Apply custom throttler exception filter for friendly error messages
  app.useGlobalFilters(new ThrottlerExceptionFilter());

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
