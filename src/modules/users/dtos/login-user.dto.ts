/* eslint-disable prettier/prettier */
// login.dto.ts
import { IsEmail, IsString } from 'class-validator';

export class LoginUserDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
