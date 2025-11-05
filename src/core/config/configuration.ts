import * as dotenv from 'dotenv';

dotenv.config();

export default () => {
  const dbUrl =
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;
  if (!dbUrl.match(/^postgres(ql)?:\/\/[^:]+:[^@]*@[^:]+(?::\d+)?\/[^/\s?]+(\?.*)?$/)) {
    throw new Error(
      'Invalid DATABASE_URL format. Expected: postgresql://user:password@host:port/db or postgresql://user:password@host/db?sslmode=require',
    );
  }

  return {
    port: parseInt(process.env.PORT || '8000', 10),
    database: {
      type: process.env.DB_TYPE || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'my_project',
      synchronize: process.env.DB_SYNCHRONIZE === 'true',
      url: dbUrl,
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      database: parseInt(process.env.REDIS_DATABASE || '0', 10),
    },
    nodeEnv: process.env.NODE_ENV || 'development',
  };
};
