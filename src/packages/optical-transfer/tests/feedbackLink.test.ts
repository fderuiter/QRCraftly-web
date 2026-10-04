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

import { describe, expect, it, vi } from 'vitest';
import { createFeedbackLink, type CameraPermission } from '../index';

/** A camera request the test settles by hand, like a permission prompt. */
function prompt() {
  let settle: (value: CameraPermission) => void = () => {};
  let fail: (reason: unknown) => void = () => {};
  const requestCamera = vi.fn(
    () =>
      new Promise<CameraPermission>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      })
  );
  return { requestCamera, answer: (value: CameraPermission) => settle(value), reject: (reason: unknown) => fail(reason) };
}

describe('feedback link opt-in and fallback (#1146)', () => {
  it('is off by default and asks for nothing until the caller opts in', () => {
    const { requestCamera } = prompt();
    const link = createFeedbackLink({ requestCamera });
    expect(link.state).toEqual({ status: 'off' });
    expect(link.profileFor('fast', 'steady')).toBe('fast');
    expect(link.shouldStop(true)).toBe(false);
    link.disable();
    link.cameraLost();
    expect(requestCamera).not.toHaveBeenCalled();
  });

  it('asks once on enable and lets the receiver steer once the camera is granted', async () => {
    const { requestCamera, answer } = prompt();
    const link = createFeedbackLink({ requestCamera });
    const first = link.enable();
    expect(link.state).toEqual({ status: 'requesting' });
    expect(link.enable()).toBe(first);
    answer('granted');
    await expect(first).resolves.toEqual({ status: 'listening' });
    expect(requestCamera).toHaveBeenCalledTimes(1);
    expect(link.profileFor('balanced', 'fast')).toBe('fast');
    expect(link.shouldStop(true)).toBe(true);
    expect(link.shouldStop(false)).toBe(false);
  });

  it.each<[CameraPermission, 'denied' | 'unavailable']>([
    ['denied', 'denied'],
    ['unavailable', 'unavailable'],
  ])('falls back to the one-way stream when the camera is %s', async (permission, reason) => {
    const { requestCamera, answer } = prompt();
    const link = createFeedbackLink({ requestCamera });
    const pending = link.enable();
    answer(permission);
    await expect(pending).resolves.toEqual({ status: 'one-way', reason });
    // The person's chosen profile stands, and the stream never stops by itself.
    expect(link.profileFor('balanced', 'fast')).toBe('balanced');
    expect(link.shouldStop(true)).toBe(false);
  });

  it('falls back when the request itself throws', async () => {
    const { requestCamera, reject } = prompt();
    const link = createFeedbackLink({ requestCamera });
    const pending = link.enable();
    reject(new Error('NotReadableError'));
    await expect(pending).resolves.toEqual({ status: 'one-way', reason: 'error' });
  });

  it('falls back when the camera goes away, and releases it', async () => {
    const { requestCamera, answer } = prompt();
    const releaseCamera = vi.fn();
    const link = createFeedbackLink({ requestCamera, releaseCamera });
    const pending = link.enable();
    answer('granted');
    await pending;
    link.cameraLost();
    expect(link.state).toEqual({ status: 'one-way', reason: 'camera-lost' });
    expect(releaseCamera).toHaveBeenCalledTimes(1);
    expect(link.profileFor('steady', 'fast')).toBe('steady');
    expect(link.shouldStop(true)).toBe(false);
  });

  it('turning it off releases the camera and returns to off', async () => {
    const { requestCamera, answer } = prompt();
    const releaseCamera = vi.fn();
    const link = createFeedbackLink({ requestCamera, releaseCamera });
    const pending = link.enable();
    answer('granted');
    await pending;
    link.disable();
    expect(link.state).toEqual({ status: 'off' });
    expect(releaseCamera).toHaveBeenCalledTimes(1);
  });

  it('drops a grant that arrives after the person turned it off, and releases that camera', async () => {
    const { requestCamera, answer } = prompt();
    const releaseCamera = vi.fn();
    const link = createFeedbackLink({ requestCamera, releaseCamera });
    const pending = link.enable();
    link.disable();
    answer('granted');
    await pending;
    expect(link.state).toEqual({ status: 'off' });
    expect(releaseCamera).toHaveBeenCalledTimes(1);
  });

  it('can be turned on again after a denial, which asks again', async () => {
    let calls = 0;
    const link = createFeedbackLink({ requestCamera: () => Promise.resolve<CameraPermission>(++calls === 1 ? 'denied' : 'granted') });
    await expect(link.enable()).resolves.toMatchObject({ status: 'one-way' });
    await expect(link.enable()).resolves.toEqual({ status: 'listening' });
    expect(calls).toBe(2);
  });
});
