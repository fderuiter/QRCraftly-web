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

/*
 * Every QR type, from a filled form to the payload the encoder is given (#1612). Each case fills
 * the type's rendered form with its sample payload's fields, through the same useInputLogic commit
 * path the generator uses, and expects exactly what the generator constructs from those fields.
 * A field read from the wrong key, or a default that changes the payload, fails that type's case.
 */
import React, { useCallback, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { type QRConfig, QRType } from '@/packages/core/types';
import { SAMPLE_PAYLOADS } from '@/packages/qr-payload';
import { QRProvider } from '@/context/QRContext';
import { ToastProvider } from '../ui/Toast';
import { INPUT_REGISTRY, constructInput, type InputDataMap } from './InputRegistry';
import { clearRetainedInputStates, useInputLogic } from './useInputLogic';

/** How to set one form field: the control's label, or a file input that receives the value. */
type Fill = string | RegExp | { upload: string; fileName: string };

/**
 * The control for every field a sample fills, per type. A new QR type must add its row, and a
 * sample field with no control here fails the case, so no field is skipped silently.
 */
const FILLS: { [K in QRType]: Partial<Record<keyof InputDataMap[K], Fill>> } = {
  [QRType.URL]: { url: 'Website URL' },
  [QRType.TEXT]: { text: 'Content' },
  [QRType.WIFI]: {
    ssid: 'Network Name (SSID)',
    encryption: 'Encryption',
    password: 'Password',
    hidden: 'Hidden Network',
  },
  [QRType.EVENT]: {
    title: 'Event Title',
    startDate: 'Start Date & Time',
    endDate: 'End Date & Time',
    location: 'Location',
    description: 'Description',
  },
  [QRType.EMAIL]: { email: 'Email Address', cc: 'CC', bcc: 'BCC', subject: 'Subject', body: 'Body' },
  [QRType.VCARD]: {
    version: 'Contact Format',
    firstName: 'First Name',
    lastName: 'Last Name',
    organization: 'Company / Organization',
    title: 'Job Title',
    phone: 'Mobile Phone',
    email: 'Email',
    website: 'Website',
    street: 'Street',
    city: 'City',
    zip: 'ZIP / Postal Code',
    country: 'Country',
  },
  [QRType.PHONE]: { number: 'Phone Number' },
  [QRType.SMS]: { number: 'Phone Number', message: 'Pre-filled Message' },
  [QRType.PAYMENT]: {
    network: 'Currency / Network',
    address: 'Receiver Address',
    amount: /^Amount/,
    label: /^Label \/ Note/,
  },
  [QRType.LOCATION]: { latitude: 'Latitude', longitude: 'Longitude' },
  [QRType.MEETING]: { url: 'Paste Meeting Link' },
  [QRType.SOCIAL]: { platform: 'Platform', handle: 'Username / Handle' },
  [QRType.BULK_CSV]: {
    csvContent: { upload: 'Upload CSV, TXT, or Excel file', fileName: 'sample.csv' },
    payloadColumn: 'Content Column',
    filenameColumn: 'File Name Column',
    contentType: 'Content Type',
    exportFormat: 'Image Format',
    exportResolution: 'PNG Width',
  },
};

/** The generator and its form, wired the way InputPanel wires them, with the payload shown. */
function Generator({ type }: { type: QRType }) {
  const [config, setConfig] = useState<Pick<QRConfig, 'type' | 'value'>>(() => ({
    type,
    value: constructInput(type, INPUT_REGISTRY[type].initialState),
  }));
  const onChange = useCallback((updates: Partial<QRConfig>) => setConfig((current) => ({ ...current, ...updates })), []);
  const { InputComponent, inputProps, flush } = useInputLogic(config, onChange);
  return (
    <>
      <InputComponent {...inputProps} />
      <button type="button" onClick={flush}>
        Commit
      </button>
      <output data-testid="payload">{config.value}</output>
    </>
  );
}

/** Treats an absent field and an empty one alike, as every construct does. */
const blank = (value: unknown) => value === undefined || value === '';

async function fill(field: string, how: Fill, value: unknown): Promise<void> {
  if (typeof how === 'object' && !(how instanceof RegExp)) {
    const file = new File([String(value)], how.fileName, { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText(how.upload, {}, { timeout: 10_000 }), { target: { files: [file] } });
    return;
  }
  // Lazy forms (event, social, bulk CSV) load their chunk first.
  const control = await screen.findByLabelText(how, {}, { timeout: 10_000 });
  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    if (control.checked !== Boolean(value)) fireEvent.click(control);
  } else {
    fireEvent.change(control, { target: { value: String(value ?? '') } });
  }
  expect(control, `${field} control`).toBeInTheDocument();
}

describe('every QR type from form to encoder (#1612)', () => {
  beforeEach(() => {
    clearRetainedInputStates();
  });

  it('has a sample payload and a fill row for every QR type', () => {
    for (const type of Object.values(QRType)) {
      expect(SAMPLE_PAYLOADS, `no sample payload for ${type}`).toHaveProperty(type);
      expect(FILLS, `no form fill for ${type}`).toHaveProperty(type);
    }
  });

  it.each(Object.values(QRType))('%s: the filled form hands the encoder what the generator builds', async (type) => {
    const entry = INPUT_REGISTRY[type];
    const target: Record<string, unknown> = { ...entry.initialState, ...entry.hydrate(SAMPLE_PAYLOADS[type]) };
    const initial: Record<string, unknown> = { ...entry.initialState };
    const fills: Record<string, Fill | undefined> = FILLS[type];

    const unfilled = Object.keys(target).filter((key) => !fills[key] && !(blank(target[key]) && blank(initial[key])) && target[key] !== initial[key]);
    expect(unfilled, `${type} sample fields with no form control`).toEqual([]);

    render(
      <ToastProvider>
        <QRProvider>
          <Generator type={type} />
        </QRProvider>
      </ToastProvider>
    );
    for (const [field, how] of Object.entries(fills)) {
      if (how) await fill(field, how, target[field]);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

    const expected = constructInput(type, { ...entry.initialState, ...entry.hydrate(SAMPLE_PAYLOADS[type]) });
    await waitFor(() => expect(screen.getByTestId('payload').textContent).toBe(expected));
  });
});
