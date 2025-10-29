import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') {
            return false;
          }

          // Minimum 8 characters
          if (value.length < 8) {
            return false;
          }

          // Maximum 128 characters (prevent DoS attacks)
          if (value.length > 128) {
            return false;
          }

          // Must contain at least one uppercase letter
          if (!/[A-Z]/.test(value)) {
            return false;
          }

          // Must contain at least one lowercase letter
          if (!/[a-z]/.test(value)) {
            return false;
          }

          // Must contain at least one number
          if (!/[0-9]/.test(value)) {
            return false;
          }

          // Must contain at least one special character

          if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value)) {
            return false;
          }

          return true;
        },
        defaultMessage() {
          return (
            'Mật khẩu phải có ít nhất 8 ký tự, bao gồm: ' +
            '1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt (!@#$%^&*...)'
          );
        },
      },
    });
  };
}
