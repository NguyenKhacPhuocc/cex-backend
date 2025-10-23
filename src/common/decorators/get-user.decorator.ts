/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from 'src/modules/users/entities/user.entity';
export const GetUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as User; // User được gắn bởi JwtAuthGuard

    // Nếu data được chỉ định (e.g., @GetUser('id')), trả về thuộc tính cụ thể
    return data ? user?.[data] : user; // Trả về toàn bộ User hoặc một field cụ thể
  },
);
