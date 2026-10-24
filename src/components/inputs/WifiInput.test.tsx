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

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { WifiInput } from './WifiInput';
import { type WifiData, WifiEapMethod, WifiEapPhase2, WifiEncryption } from '@/packages/core/types';

const enterprise: WifiData = {
  ssid: 'Corp',
  password: 'secret',
  encryption: WifiEncryption.WPA2_EAP,
  hidden: false,
  eapIdentity: 'user',
};

describe('WifiInput enterprise (WPA2-EAP) fields', () => {
  it('shows EAP method and phase 2 selects with PEAP/MSCHAPV2 defaults', async () => {
    const { container } = render(<WifiInput data={enterprise} onChange={vi.fn()} />);
    expect(screen.getByLabelText('EAP Method')).toHaveValue(WifiEapMethod.PEAP);
    expect(screen.getByLabelText('Phase 2 Authentication')).toHaveValue(WifiEapPhase2.MSCHAPV2);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('reports EAP method and phase 2 changes', () => {
    const onChange = vi.fn();
    render(<WifiInput data={enterprise} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('EAP Method'), { target: { value: WifiEapMethod.TTLS } });
    expect(onChange).toHaveBeenLastCalledWith({ eapMethod: WifiEapMethod.TTLS });
    fireEvent.change(screen.getByLabelText('Phase 2 Authentication'), { target: { value: WifiEapPhase2.PAP } });
    expect(onChange).toHaveBeenLastCalledWith({ eapPhase2: WifiEapPhase2.PAP });
  });

  it('hides phase 2 for EAP-TLS', () => {
    render(<WifiInput data={{ ...enterprise, eapMethod: WifiEapMethod.TLS }} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Phase 2 Authentication')).not.toBeInTheDocument();
  });

  it('hides enterprise fields for WPA personal', () => {
    render(<WifiInput data={{ ...enterprise, encryption: WifiEncryption.WPA }} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('EAP Method')).not.toBeInTheDocument();
  });

  it('renders WPA3 only (SAE) option and handles selection', () => {
    const onChange = vi.fn();
    const wifiData: WifiData = {
      ssid: 'WPA3Net',
      password: 'mypassword',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };
    render(<WifiInput data={wifiData} onChange={onChange} />);

    const select = screen.getByLabelText('Encryption') as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    const optionLabels = Array.from(select.options).map((opt) => opt.text);
    expect(optionLabels).toContain('WPA / WPA2 / WPA3 (most networks)');
    expect(optionLabels).toContain('WPA3 only (SAE)');

    fireEvent.change(select, { target: { value: WifiEncryption.SAE } });
    expect(onChange).toHaveBeenLastCalledWith({ encryption: WifiEncryption.SAE });
  });

  it('displays password field when encryption is WPA3 only (SAE)', () => {
    const wifiData: WifiData = {
      ssid: 'WPA3Net',
      password: 'mypassword',
      encryption: WifiEncryption.SAE,
      hidden: false,
    };
    render(<WifiInput data={wifiData} onChange={vi.fn()} />);

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows field note warning only when SAE encryption is selected', async () => {
    const warningText = 'Only for WPA3-only networks. Android phones read this; iPhone cameras may not. Choose WPA / WPA2 / WPA3 unless your router is set to WPA3 only.';
    const wpaData: WifiData = {
      ssid: 'MyNet',
      password: 'pass',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };
    const { container, rerender } = render(<WifiInput data={wpaData} onChange={vi.fn()} />);
    expect(screen.queryByText(warningText)).not.toBeInTheDocument();

    const saeData: WifiData = { ...wpaData, encryption: WifiEncryption.SAE };
    rerender(<WifiInput data={saeData} onChange={vi.fn()} />);
    expect(screen.getByText(warningText)).toBeInTheDocument();
    expect(screen.getByLabelText('Encryption')).toHaveAccessibleDescription(warningText);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('WifiInput WPA passphrase length validation', () => {
  it('does not display warning initially, but displays warning after blur when WPA password is shorter than 8 characters', async () => {
    const data: WifiData = {
      ssid: 'MyNet',
      password: 'short',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };
    const { container, rerender } = render(<WifiInput data={data} onChange={vi.fn()} />);
    const warningMsg = "WPA passwords are 8 to 63 characters. Phones can't join with this one.";
    expect(screen.queryByText(warningMsg)).not.toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Password'));
    expect(screen.getByText(warningMsg)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect((await axe(container)).violations).toEqual([]);

    rerender(<WifiInput data={{ ...data, password: 'longenough' }} onChange={vi.fn()} />);
    expect(screen.queryByText(warningMsg)).not.toBeInTheDocument();
  });

  it('does not display warning for WPA2-EAP password shorter than 8 characters even after blur', () => {
    const data: WifiData = {
      ssid: 'CorpNet',
      password: 'short',
      encryption: WifiEncryption.WPA2_EAP,
      hidden: false,
    };
    render(<WifiInput data={data} onChange={vi.fn()} />);
    const warningMsg = "WPA passwords are 8 to 63 characters. Phones can't join with this one.";

    fireEvent.blur(screen.getByLabelText('Password'));
    expect(screen.queryByText(warningMsg)).not.toBeInTheDocument();
  });

  it('does not display warning when WPA password is at least 8 characters', () => {
    const data: WifiData = {
      ssid: 'MyNet',
      password: 'validpass',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };
    render(<WifiInput data={data} onChange={vi.fn()} />);
    const warningMsg = "WPA passwords are 8 to 63 characters. Phones can't join with this one.";

    fireEvent.blur(screen.getByLabelText('Password'));
    expect(screen.queryByText(warningMsg)).not.toBeInTheDocument();
  });

  it('does not display warning when password field is empty', () => {
    const data: WifiData = {
      ssid: 'MyNet',
      password: '',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };
    render(<WifiInput data={data} onChange={vi.fn()} />);
    const warningMsg = "WPA passwords are 8 to 63 characters. Phones can't join with this one.";

    fireEvent.blur(screen.getByLabelText('Password'));
    expect(screen.queryByText(warningMsg)).not.toBeInTheDocument();
  });

  it('bypasses 8-character check for WEP encryption', () => {
    const data: WifiData = {
      ssid: 'LegacyNet',
      password: '12345',
      encryption: WifiEncryption.WEP,
      hidden: false,
    };
    render(<WifiInput data={data} onChange={vi.fn()} />);
    const warningMsg = "WPA passwords are 8 to 63 characters. Phones can't join with this one.";

    fireEvent.blur(screen.getByLabelText('Password'));
    expect(screen.queryByText(warningMsg)).not.toBeInTheDocument();
  });
});
