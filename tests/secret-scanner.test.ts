import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isFalsePositive,
  scanFile,
  CLOUDFLARE_REGEX,
  SMTP_PASS_REGEX,
  SMTP_URI_REGEX,
  AWS_REGEX,
  STRIPE_REGEX,
  GITHUB_REGEX,
  GCP_REGEX,
  PRIVATE_KEY_REGEX,
} from '../scripts/secret-scanner.js';

describe('secret-scanner', () => {
  describe('isFalsePositive', () => {
    it('should identify environment variable references as false positives', () => {
      expect(isFalsePositive('process.env.CF_KEY')).toBe(true);
      expect(isFalsePositive('import.meta.env.CF_KEY')).toBe(true);
      expect(isFalsePositive('$CF_KEY')).toBe(true);
      expect(isFalsePositive('${CF_KEY}')).toBe(true);
    });

    it('should identify standard placeholder patterns as false positives', () => {
      expect(isFalsePositive('<your-cloudflare-token>')).toBe(true);
      expect(isFalsePositive('your_smtp_password')).toBe(true);
      expect(isFalsePositive('placeholder-token')).toBe(true);
      expect(isFalsePositive('dummy-value')).toBe(true);
    });

    it('should identify self-assignments as false positives', () => {
      expect(isFalsePositive('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_TOKEN')).toBe(true);
      expect(isFalsePositive('SMTP_PASS', 'SMTP_PASS')).toBe(true);
      expect(isFalsePositive('smtp_password', 'smtp_password')).toBe(true);
    });

    it('should identify code evaluation terms as false positives', () => {
      expect(isFalsePositive('evaluateExpression', 'key')).toBe(true);
      expect(isFalsePositive('resolveExpression', 'cf_token')).toBe(true);
      expect(isFalsePositive('evaluateNode', 'api_key')).toBe(true);
    });

    it('should identify extremely short strings as false positives', () => {
      expect(isFalsePositive('123')).toBe(true);
      expect(isFalsePositive('   ')).toBe(true);
    });

    it('should identify legitimate dummy keys/secrets as NOT false positives', () => {
      expect(isFalsePositive('1234567890123456789012345678901234567', 'CF_API_KEY')).toBe(false);
      expect(isFalsePositive('mySecretSmtpPass123', 'SMTP_PASS')).toBe(false);
      expect(isFalsePositive('mail.pass-42', 'SMTP_PASS')).toBe(false);
      expect(isFalsePositive('correct(horse)', 'SMTP_PASS')).toBe(false);
    });
  });

  describe('Regex Patterns', () => {
    it('should match standard SMTP connection strings', () => {
      const line = 'const smtpUrl = "smtp://username:my_secure_password@smtp.mailtrap.io:2525";';
      const match = line.match(SMTP_URI_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('my_secure_password');
    });

    it('should match SMTP passwords/keys assignment', () => {
      const line = 'SMTP_PASS="super_secret_smtp_password"';
      const match = line.match(SMTP_PASS_REGEX);
      expect(match).not.toBeNull();
      expect(match![3]).toBe('super_secret_smtp_password');

      // Test expanded SMTP alias assignments
      const mailPassLine = 'mail_pass = "mySecretSmtpPass123"';
      const mailPassMatch = mailPassLine.match(SMTP_PASS_REGEX);
      expect(mailPassMatch).not.toBeNull();
      expect(mailPassMatch![3]).toBe('mySecretSmtpPass123');

      const smtpPasswordLine = 'smtp_password = "anotherSecurePass"';
      const smtpPasswordMatch = smtpPasswordLine.match(SMTP_PASS_REGEX);
      expect(smtpPasswordMatch).not.toBeNull();
      expect(smtpPasswordMatch![3]).toBe('anotherSecurePass');
    });

    it('should match Cloudflare API keys and tokens assignment', () => {
      const line1 = 'const CLOUDFLARE_API_KEY = "1234567890123456789012345678901234567";';
      const match1 = line1.match(CLOUDFLARE_REGEX);
      expect(match1).not.toBeNull();
      expect(match1![4]).toBe('1234567890123456789012345678901234567');

      const line2 = 'cf_token: "abcdefghijklmnopqrstuvwxyz0123456789abcd"';
      const match2 = line2.match(CLOUDFLARE_REGEX);
      expect(match2).not.toBeNull();
      expect(match2![4]).toBe('abcdefghijklmnopqrstuvwxyz0123456789abcd');

      // Test expanded Cloudflare generic token/key assignments
      const genericTokenLine = 'const api_token = "abcdefghijklmnopqrstuvwxyz0123456789abcd"';
      const genericTokenMatch = genericTokenLine.match(CLOUDFLARE_REGEX);
      expect(genericTokenMatch).not.toBeNull();
      expect(genericTokenMatch![4]).toBe('abcdefghijklmnopqrstuvwxyz0123456789abcd');
    });

    it('should match AWS Access Keys', () => {
      const line = 'const awsKey = "AKIA1234567890123456";';
      const match = line.match(AWS_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('AKIA1234567890123456');
    });

    it('should match Stripe API keys', () => {
      const livePrefix = 'sk_l' + 'ive_';
      const testPrefix = 'rk_t' + 'est_';
      const key1 = livePrefix + '123456789012345678901234';
      const key2 = testPrefix + 'abcdefghijklmnopqrstuvwx';

      const line1 = `const stripeKey = "${key1}";`;
      const match1 = line1.match(STRIPE_REGEX);
      expect(match1).not.toBeNull();
      expect(match1![1]).toBe(key1);

      const line2 = `stripe_test: "${key2}"`;
      const match2 = line2.match(STRIPE_REGEX);
      expect(match2).not.toBeNull();
      expect(match2![1]).toBe(key2);
    });

    it('should match GitHub Personal Access Tokens', () => {
      const line1 = 'const githubToken = "ghp_123456789012345678901234567890123456";';
      const match1 = line1.match(GITHUB_REGEX);
      expect(match1).not.toBeNull();
      expect(match1![1]).toBe('ghp_123456789012345678901234567890123456');

      const line2 = 'const fineGrained = "github_pat_1234567890123456789012_34567890abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxy";';
      const match2 = line2.match(GITHUB_REGEX);
      expect(match2).not.toBeNull();
      expect(match2![1]).toBe('github_pat_1234567890123456789012_34567890abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxy');
    });

    it('should match Google Cloud or Firebase API Keys', () => {
      const line = 'const gcpKey = "AIzaSyAz1234567890abcdefghijklmnopqrstu";';
      const match = line.match(GCP_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('AIzaSyAz1234567890abcdefghijklmnopqrstu');
    });

    it('should match PEM private key headers', () => {
      const pkcs8Key = '-----BEGIN PRIVATE KEY-----';
      const rsaKey = '-----BEGIN RSA PRIVATE KEY-----';
      const ecKey = '-----BEGIN EC PRIVATE KEY-----';
      const certificate = '-----BEGIN CERTIFICATE-----';

      expect(pkcs8Key.match(PRIVATE_KEY_REGEX)).not.toBeNull();
      expect(rsaKey.match(PRIVATE_KEY_REGEX)).not.toBeNull();
      expect(ecKey.match(PRIVATE_KEY_REGEX)).not.toBeNull();
      expect(certificate.match(PRIVATE_KEY_REGEX)).toBeNull();
    });
  });

  describe('scanFile', () => {
    const tempFileWithSecret = path.resolve('tests/temp-test-secret.ts');
    const tempFileClean = path.resolve('tests/temp-test-clean.ts');

    beforeAll(() => {
      const livePrefix = 'sk_l' + 'ive_';
      const stripeSecret = livePrefix + '123456789012345678901234';

      fs.writeFileSync(
        tempFileWithSecret,
        `
        // File containing simulated dummy secrets
        const config = {
          cloudflare_api_key: "1234567890123456789012345678901234567",
          smtp_password: "mySecretSmtpPass123",
          smtp_uri: "smtp://user:superSecretPassword@smtp.example.com",
          aws_key: "AKIA1234567890123456",
          stripe_key: "${stripeSecret}",
          github_token: "ghp_123456789012345678901234567890123456",
          gcp_key: "AIzaSyAz1234567890abcdefghijklmnopqrstu",
          private_key: "-----BEGIN RSA PRIVATE KEY-----",
        };
        `,
        'utf8'
      );

      fs.writeFileSync(
        tempFileClean,
        `
        // File containing safe, placeholder secrets and environment variable references
        const config = {
          cloudflare_api_key: process.env.CLOUDFLARE_API_KEY,
          smtp_password: "<your-smtp-password>",
          smtp_uri: "smtp://user:\${process.env.SMTP_PASSWORD}@smtp.example.com",
          aws_key: "AKIA_PLACEHOLDER",
          stripe_key: "sk_live_placeholder_key",
          github_token: "ghp_placeholder_token",
          gcp_key: "AIzaSy_placeholder",
          certificate: "-----BEGIN CERTIFICATE-----",
        };
        `,
        'utf8'
      );
    });

    afterAll(() => {
      if (fs.existsSync(tempFileWithSecret)) fs.unlinkSync(tempFileWithSecret);
      if (fs.existsSync(tempFileClean)) fs.unlinkSync(tempFileClean);
    });

    it('should successfully detect all secrets in a file with secrets', () => {
      const findings = scanFile(tempFileWithSecret);
      expect(findings.length).toBe(12);

      const types = findings.map(f => f.type);
      expect(types).toContain('Cloudflare API Secret/Token');
      expect(types).toContain('SMTP Password/Credential Assignment');
      expect(types).toContain('SMTP URI Connection String');
      expect(types).toContain('AWS Access Key ID');
      expect(types).toContain('Stripe API Key');
      expect(types).toContain('GitHub Personal Access Token');
      expect(types).toContain('Google Cloud or Firebase API Key');
      expect(types).toContain('Private Key');
    });

    it('should ignore all patterns in a clean file', () => {
      const findings = scanFile(tempFileClean);
      expect(findings.length).toBe(0);
    });
  });
});
