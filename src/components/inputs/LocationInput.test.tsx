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
import type { LocationData } from '../../types';
import { announcePolitely } from '../../utils/a11y';
import { axe } from '../../../tests/utils/axe';

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
  const view = render(<LocationInput data={data} onChange={onChange} />);
  return { ...view, onChange };
};

/** Create a minimal GeolocationPositionError-like object. */
const geoError = (code: number): GeolocationPositionError =>
  ({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) satisfies GeolocationPositionError;

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
    it('renders latitude and longitude text fields and URL link field', () => {
      renderLocationInput();
      expect(screen.getByLabelText('Latitude')).toBeInTheDocument();
      expect(screen.getByLabelText('Longitude')).toBeInTheDocument();
      expect(screen.getByLabelText(/Google Maps Link or Coordinates/i)).toBeInTheDocument();
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

  // ─── Error banner actions & manual clear ──────────────────────────────────

  describe('error banner actions and auto-clearing', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    const failGeolocation = async (code = 1) => {
      vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
        (_success, errorCb) => errorCb!(geoError(code))
      );

      const rendered = renderLocationInput();
      fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      return rendered;
    };

    it('clears geolocation error when latitude input changes', async () => {
      await failGeolocation();

      fireEvent.change(screen.getByLabelText('Latitude'), {
        target: { value: '40.7128' },
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clears geolocation error when longitude input changes', async () => {
      await failGeolocation();

      fireEvent.change(screen.getByLabelText('Longitude'), {
        target: { value: '-74.0060' },
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('dismisses error banner when Dismiss button is clicked and returns focus', async () => {
      await failGeolocation();

      const dismissButton = screen.getByRole('button', { name: /dismiss alert/i });
      expect(dismissButton).toBeInTheDocument();

      fireEvent.click(dismissButton);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /use current location/i })).toHaveFocus();
    });

    it('passes axe accessibility checks when error banner is visible', async () => {
      const { container } = await failGeolocation();
      expect(await axe(container)).toHaveNoViolations();
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
      const { DEFAULT_CONFIG } = await import('@/packages/core/config');
      const { QRType } = await import('@/packages/core/types');

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

  describe('half-typed coordinates', () => {
    it.each(['-', '+', '.', '40.', '-74.', '  -  '])('shows no error for %j while it is typed, and does after the field is left', (value) => {
      renderLocationInput({ latitude: value });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.blur(screen.getByLabelText(/Latitude/));
      expect(screen.getByText(/Latitude must be a number/)).toBeInTheDocument();
    });

    it('still flags at once a value that cannot become a coordinate', () => {
      renderLocationInput({ longitude: 'abc' });
      expect(screen.getByText(/Longitude must be a number/)).toBeInTheDocument();
    });

    it('shows nothing for a blank field, before or after it is left', () => {
      renderLocationInput({ latitude: '   ' });
      fireEvent.blur(screen.getByLabelText(/Latitude/));
      expect(screen.queryByText(/must be/)).not.toBeInTheDocument();
    });
  });

  describe('a position that arrives after the form is gone', () => {
    it('does not write into the form or announce anything', () => {
      let deliver: PositionCallback = () => {};
      Object.defineProperty(navigator, 'geolocation', {
        value: { getCurrentPosition: vi.fn((success: PositionCallback) => { deliver = success; }) },
        configurable: true,
        writable: true,
      });
      const { unmount, onChange } = renderLocationInput();
      fireEvent.click(screen.getByTestId('use-current-location'));
      unmount();
      const coords = { latitude: 40.7128, longitude: -74.006, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) };
      deliver({ coords, timestamp: 0, toJSON: () => ({}) });
      expect(onChange).not.toHaveBeenCalled();
      expect(announcePolitely).not.toHaveBeenCalled();
    });
  });

  // ─── Google Maps link and location string parsing ────────────────────────

  describe('Google Maps link and location string parsing', () => {
    it('extracts coordinates when pasting a Google Maps place pin URL and does not re-announce on blur', () => {
      const { onChange } = renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.paste(input, {
        clipboardData: {
          getData: () =>
            'https://www.google.com/maps/place/Statue+of+Liberty/@40.6892494,-74.0466891,17z/data=!3m1!4b1!4m6!3m5!1s0x89c25090129c363d:0x40c6a5770d25022b!8m2!3d40.6892494!4d-74.0445004',
        },
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        latitude: '40.689249',
        longitude: '-74.0445',
      });
      expect(announcePolitely).toHaveBeenCalledTimes(1);
      expect(announcePolitely).toHaveBeenCalledWith('Location coordinates populated');

      // Subsequent blur event
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(announcePolitely).toHaveBeenCalledTimes(1);
    });

    it('does not populate coordinates while typing, populating only on blur or Enter', () => {
      const { onChange } = renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.change(input, {
        target: { value: 'https://www.google.com/maps/@40.7128,-74.0060,15z' },
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(announcePolitely).not.toHaveBeenCalled();

      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        latitude: '40.7128',
        longitude: '-74.006',
      });
      expect(announcePolitely).toHaveBeenCalledTimes(1);
      expect(announcePolitely).toHaveBeenCalledWith('Location coordinates populated');
    });

    it('populates coordinates when Enter key is pressed', () => {
      const { onChange } = renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.change(input, {
        target: { value: '40.7128, -74.0060' },
      });

      expect(onChange).not.toHaveBeenCalled();

      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith({
        latitude: '40.7128',
        longitude: '-74.006',
      });
      expect(announcePolitely).toHaveBeenCalledTimes(1);
    });

    it('extracts coordinates when pasting a DMS string', () => {
      const { onChange } = renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.paste(input, {
        clipboardData: {
          getData: () => '40°42\'46"N 74°00\'21"W',
        },
      });

      expect(onChange).toHaveBeenCalledWith({
        latitude: '40.712778',
        longitude: '-74.005833',
      });
    });

    it('displays error message when pasting an unparseable or short URL', () => {
      renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.paste(input, {
        clipboardData: {
          getData: () => 'https://maps.app.goo.gl/invalid',
        },
      });

      expect(
        screen.getByText('Could not extract valid coordinates from the provided URL or location string.')
      ).toBeInTheDocument();
    });

    it('displays error message on blur when entering invalid text or URL with stray %', () => {
      renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.change(input, { target: { value: 'https://maps.google.com/?q=Cafe 100%' } });
      fireEvent.blur(input);

      expect(
        screen.getByText('Could not extract valid coordinates from the provided URL or location string.')
      ).toBeInTheDocument();
    });

    it('preserves pasted content and accepts typing immediately after paste without dropping characters', () => {
      renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.paste(input, {
        clipboardData: {
          getData: () => 'https://maps.google.com/123',
        },
      });

      expect(input).toHaveValue('https://maps.google.com/123');

      fireEvent.change(input, {
        target: { value: 'https://maps.google.com/1234' },
      });

      expect(input).toHaveValue('https://maps.google.com/1234');
    });

    it('retains error message on repeated blur or Enter on the same invalid text', () => {
      renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.change(input, { target: { value: 'invalid location text' } });
      fireEvent.blur(input);

      expect(
        screen.getByText('Could not extract valid coordinates from the provided URL or location string.')
      ).toBeInTheDocument();

      fireEvent.blur(input);

      expect(
        screen.getByText('Could not extract valid coordinates from the provided URL or location string.')
      ).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'Enter' });

      expect(
        screen.getByText('Could not extract valid coordinates from the provided URL or location string.')
      ).toBeInTheDocument();
    });

    it('replaces existing field text and parses pasted content when user pastes into field', () => {
      const { onChange } = renderLocationInput();
      const input = screen.getByLabelText(/Google Maps Link or Coordinates/i);

      fireEvent.change(input, { target: { value: 'some existing text' } });

      fireEvent.paste(input, {
        clipboardData: {
          getData: () => 'https://www.google.com/maps/@40.7128,-74.0060,15z',
        },
      });

      expect(input).toHaveValue('https://www.google.com/maps/@40.7128,-74.0060,15z');
      expect(onChange).toHaveBeenCalledWith({
        latitude: '40.7128',
        longitude: '-74.006',
      });
    });
  });
});
