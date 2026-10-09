/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, it, expect } from 'vitest';
import { constructEmailString, hydrateEmailData, EmailContract } from '../index';
import { QRType } from '@/types';

describe('Email generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      email: 'test@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      subject: 'Hello World',
      body: 'How are you?',
    };
    const str = constructEmailString(data);
    expect(str).toBe(
      'mailto:test@example.com?cc=cc%40example.com&bcc=bcc%40example.com&subject=Hello%20World&body=How%20are%20you%3F'
    );
    const hydrated = hydrateEmailData(str);
    expect(hydrated).toEqual(data);
  });

  it('omits cc and bcc when empty or whitespace only', () => {
    const data = {
      email: 'test@example.com',
      cc: '   ',
      bcc: '',
      subject: 'Hello',
      body: 'World',
    };
    const str = constructEmailString(data);
    expect(str).toBe('mailto:test@example.com?subject=Hello&body=World');
    expect(hydrateEmailData(str)).toEqual({
      email: 'test@example.com',
      cc: '',
      bcc: '',
      subject: 'Hello',
      body: 'World',
    });
  });

  it('supports comma-separated recipient lists in cc and bcc', () => {
    const data = {
      email: 'test@example.com',
      cc: 'cc1@example.com, cc2@example.com',
      bcc: 'bcc1@example.com, bcc2@example.com',
      subject: 'Group Email',
      body: 'Sync',
    };
    const str = constructEmailString(data);
    const hydrated = hydrateEmailData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates MATMSG format', () => {
    const hydrated = hydrateEmailData(
      'MATMSG:TO:test@example.com;SUB:Hello World;BODY:How are you?;;'
    );
    expect(hydrated).toEqual({
      email: 'test@example.com',
      cc: '',
      bcc: '',
      subject: 'Hello World',
      body: 'How are you?',
    });
  });

  it('hydrates MATMSG format with escaped semicolons and lookahead recombination', () => {
    const hydrated = hydrateEmailData(
      'MATMSG:TO:test@example.com;SUB:Subject with \\; escaped semicolon;BODY:Hello; World; This is a trailing \\; escaped;'
    );
    expect(hydrated).toEqual({
      email: 'test@example.com',
      cc: '',
      bcc: '',
      subject: 'Subject with ; escaped semicolon',
      body: 'Hello; World; This is a trailing ; escaped',
    });
  });

  it('hydrates MATMSG format with invalid part', () => {
    const hydrated = hydrateEmailData('MATMSG:INVALID;;');
    expect(hydrated).toEqual({
      email: '',
      cc: '',
      bcc: '',
      subject: '',
      body: '',
    });
  });

  it('returns default for unknown format or invalid url', () => {
    expect(hydrateEmailData('random')).toEqual({ email: '', cc: '', bcc: '', subject: '', body: '' });
    expect(hydrateEmailData('mailto:http://%%invalid')).toEqual({
      email: 'http://%%invalid',
      cc: '',
      bcc: '',
      subject: '',
      body: '',
    });
  });

  it('returns default for non-email schemes', () => {
    expect(hydrateEmailData('tel:1234567890')).toEqual({ email: '', cc: '', bcc: '', subject: '', body: '' });
  });

  it('implements EmailContract correctly and validates emails', () => {
    expect(EmailContract.type).toBe(QRType.EMAIL);
    expect(EmailContract.matches('mailto:test@example.com')).toBe(true);
    expect(EmailContract.matches('tel:12345')).toBe(false);

    // Valid mailto starting
    expect(EmailContract.validate?.('mailto:test@example.com')).toEqual([]);

    // Invalid mailto starting
    expect(EmailContract.validate?.('mailto:invalid_email')).toEqual([
      'EMAIL_STRUCTURE_VIOLATION',
    ]);

    // Non-mailto starting
    expect(EmailContract.validate?.('invalid_email')).toEqual(['EMAIL_STRUCTURE_VIOLATION']);
  });

  it('deeply validates standard mailto protocols and metadata', () => {
    // Valid standard mailto
    expect(EmailContract.validate?.('mailto:test@example.com?subject=Hello&body=World')).toEqual(
      []
    );

    // Valid mailto with cc and bcc
    expect(
      EmailContract.validate?.(
        'mailto:test@example.com?cc=cc@example.com&bcc=bcc@example.com&subject=Hello&body=World'
      )
    ).toEqual([]);

    // Valid mailto with no query parameters
    expect(EmailContract.validate?.('mailto:test@example.com')).toEqual([]);

    // Mailto with invalid query parameter key (unsupported/malicious parameter injection)
    expect(
      EmailContract.validate?.('mailto:test@example.com?subject=Hello&unsupported=value')
    ).toEqual(['DELIMITER_VIOLATION']);

    // Mailto with double ? (unescaped delimiter)
    expect(EmailContract.validate?.('mailto:test@example.com?subject=Hello?world')).toEqual([
      'DELIMITER_VIOLATION',
    ]);

    // Mailto with unescaped & parameter issues (e.g. trailing & or empty parameter)
    expect(EmailContract.validate?.('mailto:test@example.com?subject=Hello&')).toEqual([
      'DELIMITER_VIOLATION',
    ]);
    expect(EmailContract.validate?.('mailto:test@example.com?subject=Hello&&body=World')).toEqual([
      'DELIMITER_VIOLATION',
    ]);
  });

  it('deeply validates MATMSG protocols and metadata', () => {
    // Compliant MATMSG payload passes validation
    expect(
      EmailContract.validate?.(
        'MATMSG:TO:test@example.com;SUB:Hello World;BODY:How are you?;;'
      )
    ).toEqual([]);

    // Compliant MATMSG payload with escaped semicolons passes validation
    expect(
      EmailContract.validate?.(
        'MATMSG:TO:test@example.com;SUB:Subject with \\; escaped semicolon;BODY:Hello\\; World;;'
      )
    ).toEqual([]);

    // Invalid email address embedded in MATMSG triggers EMAIL_STRUCTURE_VIOLATION
    expect(EmailContract.validate?.('MATMSG:TO:invalid_email;SUB:Hello;BODY:World;;')).toEqual([
      'EMAIL_STRUCTURE_VIOLATION',
    ]);

    // Missing email in MATMSG triggers EMAIL_STRUCTURE_VIOLATION
    expect(EmailContract.validate?.('MATMSG:SUB:Hello;BODY:World;;')).toEqual([
      'EMAIL_STRUCTURE_VIOLATION',
    ]);

    // Unescaped semicolon delimiter in MATMSG triggers DELIMITER_VIOLATION (because it splits into a segment that doesn't start with TO, SUB, or BODY)
    expect(
      EmailContract.validate?.('MATMSG:TO:test@example.com;SUB:Hello;World;BODY:How are you?;;')
    ).toEqual(['DELIMITER_VIOLATION']);

    // Invalid/malicious key in MATMSG block triggers DELIMITER_VIOLATION
    expect(
      EmailContract.validate?.('MATMSG:TO:test@example.com;INJECTED:value;SUB:Hello;;')
    ).toEqual(['DELIMITER_VIOLATION']);
  });
});
