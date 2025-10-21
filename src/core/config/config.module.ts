import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true, // Làm cho ConfigModule khả dụng toàn cục
    }),
  ],
})
export class AppConfigModule {}
