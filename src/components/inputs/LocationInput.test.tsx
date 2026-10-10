/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocationInput } from './LocationInput';
import { LocationData } from '../../types';
import { announcePolitely } from '../../utils/a11y';

vi.mock('../../utils/a11y', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/a11y')>();
  return {
    ...actual,
    announcePolitely: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultData: LocationData = { latitude: '', longitude: '' };

const renderLocationInput = (
  overrides: Partial<LocationData> = {},
  onChange = vi.fn()
) => {
  const data = { ...defaultData, ...overrides };
  render(<LocationInput data={data} onChange={onChange} />);
  return { onChange };
};

/** Create a minimal GeolocationPositionError-like object. */
const geoError = (code: number): GeolocationPositionError =>
  ({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocationInput component', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ─── Rendering ────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders latitude and longitude text fields', () => {
      renderLocationInput();
      expect(screen.getByLabelText('Latitude')).toBeInTheDocument();
      expect(screen.getByLabelText('Longitude')).toBeInTheDocument();
    });

    it('renders the "Use Current Location" button', () => {
      renderLocationInput();
      expect(screen.getByRole('button', { name: /use current location/i })).toBeInTheDocument();
    });

    it('displays provided latitude and longitude values', () => {
      renderLocationInput({ latitude: '51.5074', longitude: '-0.1278' });
      expect(screen.getByLabelText('Latitude')).toHaveValue('51.5074');
      expect(screen.getByLabelText('Longitude')).toHaveValue('-0.1278');
    });

    it('does not render an error message initially', () => {
      renderLocationInput();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('button is enabled and not loading initially', () => {
      renderLocationInput();
      const btn = screen.getByRole('button', { name: /use current location/i });
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  // ─── Manual field editing ─────────────────────────────────────────────────

  describe('manual field editing', () => {
    it('calls onChange when latitude field changes', () => {
      const { onChange } = renderLocationInput();
      fireEvent.change(screen.getByLabelText('Latitude'), {
        target: { value: '40.7128' },
      });
      expect(onChange).toHaveBeenCalledWith({ latitude: '40.7128' });
    });

    it('calls onChange when longitude field changes', () => {
      const { onChange } = renderLocationInput();
      fireEvent.change(screen.getByLabelText('Longitude'), {
        target: { value: '-74.0060' },
      });
      expect(onChange).toHaveBeenCalledWith({ longitude: '-74.0060' });
    });
  });

  // ─── Geolocation – success ─────────────────────────────────────────────────

  describe('Use Current Location button – success', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    it('calls navigator.geolocation.getCurrentPosition when clicked', () => {
      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));
      expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it('shows "Fetching location…" and disables the button while loading', () => {
      // getCurrentPosition never calls back, simulating an in-progress request
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(() => {});

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      const btn = screen.getByRole('button', { name: /fetching location/i });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    it('calls onChange with latitude and longitude on success', async () => {
      const successPosition = {
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      } as GeolocationPosition;

      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (successCb) => successCb(successPosition)
      );

      const { onChange } = renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith({
          latitude: '51.5074',
          longitude: '-0.1278',
        });
      });
    });

    it('triggers polite announcement on successful fetch', async () => {
      const successPosition = {
        coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 10 },
      } as GeolocationPosition;

      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (successCb) => successCb(successPosition)
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(announcePolitely).toHaveBeenCalledTimes(1);
        expect(announcePolitely).toHaveBeenCalledWith('Location coordinates populated');
      });
    });

    it('restores button text and re-enables it after a successful fetch', async () => {
      const successPosition = {
        coords: { latitude: 48.8566, longitude: 2.3522, accuracy: 5 },
      } as GeolocationPosition;

      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (successCb) => successCb(successPosition)
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /use current location/i });
        expect(btn).not.toBeDisabled();
        expect(btn).not.toHaveAttribute('aria-busy', 'true');
      });
    });

    it('clears any previous error on a successful fetch', async () => {
      // First call fails
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementationOnce(
        (_success, errorCb) => errorCb!(geoError(1))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument()
      );

      // Second call succeeds
      const successPosition = {
        coords: { latitude: 10, longitude: 20, accuracy: 5 },
      } as GeolocationPosition;
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementationOnce(
        (successCb) => successCb(successPosition)
      );

      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      );
    });
  });

  // ─── Geolocation – errors ──────────────────────────────────────────────────

  describe('Use Current Location button – errors', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    it('shows a permission-denied error message (code 1)', async () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(1))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /location access denied/i
        );
      });
    });

    it('shows a position-unavailable error message (code 2)', async () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(2))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /location unavailable/i
        );
      });
    });

    it('shows a timeout error message (code 3)', async () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(3))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
      });
    });

    it('shows a generic error message for unknown error codes', async () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(99))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/unknown error/i);
      });
    });

    it('does not route high-priority geolocation errors through the polite announcer', async () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(1))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/location access denied/i);
        expect(announcePolitely).not.toHaveBeenCalled();
      });
    });

    it('re-enables the button after an error', async () => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(1))
      );

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /use current location/i })).not.toBeDisabled();
      });
    });
  });

  // ─── Geolocation – unavailable ────────────────────────────────────────────

  describe('Use Current Location button – geolocation unavailable', () => {
    it('shows an error when navigator.geolocation is undefined', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /geolocation is not supported/i
        );
      });
    });
  });

  // ─── Geolocation via InputPanel integration ────────────────────────────────

  describe('integration via InputPanel', () => {
    it('populates lat/lng fields via the InputPanel when geolocation succeeds', async () => {
      const { render: rRender, screen: rScreen, fireEvent: rFire, waitFor: rWait } =
        await import('@testing-library/react');
      const { default: InputPanel } = await import('../InputPanel');
      const { DEFAULT_CONFIG } = await import('../../constants');
      const { QRType } = await import('../../types');

      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn(),
        },
        configurable: true,
        writable: true,
      });

      const successPosition = {
        coords: { latitude: 34.0522, longitude: -118.2437, accuracy: 20 },
      } as GeolocationPosition;

      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (successCb) => successCb(successPosition)
      );

      const mockOnChange = vi.fn();
      const config = { ...DEFAULT_CONFIG, type: QRType.LOCATION, value: '' };

      rRender(<InputPanel config={config} onChange={mockOnChange} />);
      rFire.click(rScreen.getByRole('button', { name: /use current location/i }));

      await rWait(() => {
        const latInput = rScreen.getByLabelText('Latitude');
        expect(latInput).toHaveValue('34.0522');
        const lngInput = rScreen.getByLabelText('Longitude');
        expect(lngInput).toHaveValue('-118.2437');
      });
    });
  });

  describe('Coordinate errors (#1270)', () => {
    it('explains a value that is not a coordinate', () => {
      renderLocationInput({ latitude: '12abc', longitude: '74.0060 W' });
      expect(screen.getByLabelText('Latitude')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText(/Latitude must be a number in degrees/)).toBeInTheDocument();
      expect(screen.getByLabelText('Longitude')).toHaveAttribute('aria-invalid', 'false');
    });

    it('accepts a decimal comma without an error', () => {
      renderLocationInput({ latitude: '52,52', longitude: '13,405' });
      expect(screen.queryByText(/must be/)).not.toBeInTheDocument();
    });
  });
});
