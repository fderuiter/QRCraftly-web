/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { describe, expect, it } from 'vitest';

import { getConfiguredPublicDomain } from '../site';

describe('getConfiguredPublicDomain', () => {
  it('uses the Vite domain when both environments provide one', () => {
    expect(
      getConfiguredPublicDomain({
        viteDomain: 'https://vite.qrcraftly.test',
        nodeProcess: { env: { VITE_DOMAIN: 'https://node.qrcraftly.test' } },
      }),
    ).toBe('https://vite.qrcraftly.test');
  });

  it('uses the Node domain when Vite does not provide one', () => {
    expect(
      getConfiguredPublicDomain({
        viteDomain: undefined,
        nodeProcess: { env: { VITE_DOMAIN: 'https://node.qrcraftly.test' } },
      }),
    ).toBe('https://node.qrcraftly.test');
  });

  it('uses the public fallback domain when process is unavailable', () => {
    expect(
      getConfiguredPublicDomain({
        viteDomain: undefined,
        nodeProcess: undefined,
      }),
    ).toBe('https://qrcraftly.com');
  });

  it('uses the public fallback domain when neither environment configures a domain', () => {
    expect(
      getConfiguredPublicDomain({
        viteDomain: undefined,
        nodeProcess: { env: {} },
      }),
    ).toBe('https://qrcraftly.com');
  });
});
