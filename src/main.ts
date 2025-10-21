import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { env } from 'process';
import { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({ origin: '*' });

  // Use global validation pipe
  app.useGlobalPipes(new ValidationPipe());

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
