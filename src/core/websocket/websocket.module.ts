import { Module, forwardRef } from '@nestjs/common';
import { TradingWebSocketGateway } from './websocket.gateway';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TradingModule } from '../../modules/trading/trading.module';
import { MarketModule } from '../../modules/market/market.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => TradingModule),
    forwardRef(() => MarketModule), // Use forwardRef to avoid circular dependency
  ],
  providers: [TradingWebSocketGateway],
  exports: [TradingWebSocketGateway],
})
export class WebSocketModule {}
