/* eslint-disable no-useless-escape */
/**
 * Password strength checker utility
 */

export interface PasswordStrength {
  score: number; // 0-4 (weak to strong)
  feedback: string[];
  isStrong: boolean;
}

export class PasswordStrengthUtil {
  /**
   * Check password strength and provide feedback
   */
  static checkStrength(password: string): PasswordStrength {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (password.length >= 8) {
      score++;
    } else {
      feedback.push('Mật khẩu cần ít nhất 8 ký tự');
    }

    if (password.length >= 12) {
      score++;
    }

    // Uppercase check
    if (/[A-Z]/.test(password)) {
      score++;
    } else {
      feedback.push('Thêm ít nhất 1 chữ hoa');
    }

    // Lowercase check
    if (/[a-z]/.test(password)) {
      score++;
    } else {
      feedback.push('Thêm ít nhất 1 chữ thường');
    }

    // Number check
    if (/[0-9]/.test(password)) {
      score++;
    } else {
      feedback.push('Thêm ít nhất 1 số');
    }

    // Special character check
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      score++;
    } else {
      feedback.push('Thêm ít nhất 1 ký tự đặc biệt (!@#$%^&*...)');
    }

    // Common password check
    if (this.isCommonPassword(password)) {
      score = Math.max(0, score - 2);
      feedback.push('Mật khẩu quá phổ biến, dễ bị đoán');
    }

    // Sequential characters check
    if (this.hasSequentialChars(password)) {
      score = Math.max(0, score - 1);
      feedback.push('Tránh sử dụng ký tự liên tiếp (abc, 123...)');
    }

    // Normalize score to 0-4
    score = Math.min(4, Math.max(0, score));

    return {
      score,
      feedback: feedback.length > 0 ? feedback : ['Mật khẩu mạnh!'],
      isStrong: score >= 4,
    };
  }

  /**
   * Check if password is in common password list
   */
  private static isCommonPassword(password: string): boolean {
    const commonPasswords = [
      'password',
      '123456',
      '12345678',
      'qwerty',
      'abc123',
      'monkey',
      '1234567',
      'letmein',
      'trustno1',
      'dragon',
      'baseball',
      'iloveyou',
      'master',
      'sunshine',
      'ashley',
      'bailey',
      'passw0rd',
      'shadow',
      '123123',
      '654321',
      'superman',
      'qazwsx',
      'michael',
      'football',
      'welcome',
      'jesus',
      'ninja',
      'mustang',
      'password1',
      '123456789',
    ];

    return commonPasswords.includes(password.toLowerCase());
  }

  /**
   * Check for sequential characters
   */
  private static hasSequentialChars(password: string): boolean {
    const sequences = [
      'abcdefghijklmnopqrstuvwxyz',
      '0123456789',
      'qwertyuiop',
      'asdfghjkl',
      'zxcvbnm',
    ];

    const lower = password.toLowerCase();

    for (const seq of sequences) {
      for (let i = 0; i < seq.length - 2; i++) {
        const pattern = seq.substring(i, i + 3);
        const reversePattern = pattern.split('').reverse().join('');

        if (lower.includes(pattern) || lower.includes(reversePattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generate a strong random password
   */
  static generateStrongPassword(length: number = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    const allChars = uppercase + lowercase + numbers + special;
    let password = '';

    // Ensure at least one of each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];

    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle the password
    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }
}
