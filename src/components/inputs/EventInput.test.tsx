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


import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { EventInput, FALLBACK_TIMEZONES, formatTimezoneLabel, toggleAllDay, webCalendarNotes } from './EventInput';
import { CalendarProvider, type EventData } from '../../types';

const event: EventData = {
  title: 'Launch',
  startDate: '2025-12-24T18:00',
  endDate: '2025-12-26T12:00',
  location: '',
  description: '',
};

describe('EventInput', () => {
  it('switches to all-day and back, keeping the days', () => {
    const allDay = toggleAllDay(event, true);
    expect(allDay).toEqual({ allDay: true, startDate: '2025-12-24', endDate: '2025-12-26' });
    expect(toggleAllDay({ ...event, ...allDay }, false)).toEqual({
      allDay: false,
      startDate: '2025-12-24T09:00',
      endDate: '2025-12-26T10:00',
    });
  });

  it('shows date fields and hides the time zone for an all-day event', () => {
    render(<EventInput data={{ ...event, allDay: true, startDate: '2025-12-24', endDate: '2025-12-26' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Start Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Last Day')).toHaveAttribute('type', 'date');
    expect(screen.queryByLabelText('Timezone')).not.toBeInTheDocument();
  });

  it('sends the all-day change from the switch', () => {
    const onChange = vi.fn();
    render(<EventInput data={event} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'All-day event' }));
    expect(onChange).toHaveBeenCalledWith({ allDay: true, startDate: '2025-12-24', endDate: '2025-12-26' });
  });

  it('says a web calendar receives the details (#1364)', () => {
    expect(webCalendarNotes(CalendarProvider.ICAL)).toEqual([]);
    expect(webCalendarNotes(undefined)).toEqual([]);
    render(<EventInput data={{ ...event, provider: CalendarProvider.GOOGLE }} onChange={vi.fn()} />);
    expect(screen.getByText(/sends the event's title, times, location and description to Google/)).toBeInTheDocument();
    expect(screen.getByLabelText('Target Calendar')).toHaveAttribute('aria-describedby', expect.stringContaining('event-provider-hints'));
  });

  it('formats timezone display labels correctly', () => {
    expect(formatTimezoneLabel('UTC')).toBe('UTC');
    expect(formatTimezoneLabel('Europe/Amsterdam')).toBe('Amsterdam (Europe/Amsterdam)');
    expect(formatTimezoneLabel('Asia/Dubai')).toBe('Dubai (Asia/Dubai)');
    expect(formatTimezoneLabel('America/Indiana/Indianapolis')).toBe('Indiana - Indianapolis (America/Indiana/Indianapolis)');
  });

  it('includes standard IANA timezones in dropdown and updates data.timezone upon selection', () => {
    const onChange = vi.fn();
    render(<EventInput data={event} onChange={onChange} />);

    const select = screen.getByLabelText('Timezone') as HTMLSelectElement;

    // Verify unlisted standard IANA timezones (such as Asia/Dubai and Europe/Amsterdam) are present
    expect(screen.getByRole('option', { name: 'Amsterdam (Europe/Amsterdam)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dubai (Asia/Dubai)' })).toBeInTheDocument();

    // Select Europe/Amsterdam and check onChange callback
    fireEvent.change(select, { target: { value: 'Europe/Amsterdam' } });
    expect(onChange).toHaveBeenCalledWith({ timezone: 'Europe/Amsterdam' });
  });

  it('renders custom or unlisted timezone value present in data.timezone', () => {
    const customData: EventData = { ...event, timezone: 'Custom/Timezone_Location' };
    render(<EventInput data={customData} onChange={vi.fn()} />);

    const select = screen.getByLabelText('Timezone') as HTMLSelectElement;
    expect(select.value).toBe('Custom/Timezone_Location');
    expect(screen.getByRole('option', { name: 'Timezone Location (Custom/Timezone_Location)' })).toBeInTheDocument();
  });

  it('renders pinned common timezones in Common optgroup with friendly labels', () => {
    render(<EventInput data={event} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Common' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'All Timezones' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Eastern Time (America/New_York)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Central Time (America/Chicago)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pacific Time (America/Los_Angeles)' })).toBeInTheDocument();
  });

  it('uses the fallback list on initial pre-render and expands to full IANA list after mount', () => {
    // 1. Server pre-render uses the fallback list of 26 timezones
    const htmlString = renderToString(<EventInput data={event} onChange={vi.fn()} />);
    expect(htmlString).toContain('label="All Timezones"');
    // Non-fallback timezone like Africa/Accra is NOT present in server HTML
    expect(htmlString).not.toContain('Africa/Accra');
    // Fallback timezone like Europe/Amsterdam IS present
    expect(htmlString).toContain('Amsterdam (Europe/Amsterdam)');

    // 2. Client render mounts and useEffect expands to full IANA timezone list
    render(<EventInput data={event} onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Accra (Africa/Accra)' })).toBeInTheDocument();
  });

  it('keeps selected data.timezone in the list on both passes', () => {
    const customEvent: EventData = { ...event, timezone: 'Africa/Casablanca' };
    const htmlString = renderToString(<EventInput data={customEvent} onChange={vi.fn()} />);
    expect(htmlString).toContain('Casablanca (Africa/Casablanca)');

    render(<EventInput data={customEvent} onChange={vi.fn()} />);
    const select = screen.getByLabelText('Timezone') as HTMLSelectElement;
    expect(select.value).toBe('Africa/Casablanca');
    expect(screen.getByRole('option', { name: 'Casablanca (Africa/Casablanca)' })).toBeInTheDocument();
  });

  it('produces server-rendered HTML matching initial client fallback tree to prevent hydration mismatch', () => {
    const htmlString = renderToString(<EventInput data={event} onChange={vi.fn()} />);

    // Server-rendered markup must contain both optgroups
    expect(htmlString).toContain('label="Common"');
    expect(htmlString).toContain('label="All Timezones"');
    // Common timezones with friendly labels are rendered
    expect(htmlString).toContain('Eastern Time (America/New_York)');
    // Fallback timezone in All Timezones optgroup is rendered on server
    expect(htmlString).toContain('Amsterdam (Europe/Amsterdam)');
  });

  it('hydrates without hydration warnings or errors when mounting client-side over SSR markup', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ssrHtml = renderToString(<EventInput data={event} onChange={vi.fn()} />);
    container.innerHTML = ssrHtml;

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <EventInput data={event} onChange={vi.fn()} />);
    });

    const hydrationMismatchErrors = consoleErrorSpy.mock.calls.filter(([msg]) =>
      typeof msg === 'string' && (
        msg.includes('Hydration failed') ||
        msg.includes('Did not match') ||
        msg.includes('Text content does not match') ||
        msg.includes('Prop `%s` did not match')
      )
    );

    expect(hydrationMismatchErrors).toHaveLength(0);

    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    document.body.removeChild(container);
    consoleErrorSpy.mockRestore();
  });

  it('falls back to static timezone list when Intl.supportedValuesOf is unavailable', () => {
    const originalSupportedValuesOf = Intl.supportedValuesOf;
    // @ts-expect-error Mocking for test
    delete Intl.supportedValuesOf;

    try {
      render(<EventInput data={event} onChange={vi.fn()} />);
      expect(screen.getByRole('option', { name: 'Amsterdam (Europe/Amsterdam)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Dubai (Asia/Dubai)' })).toBeInTheDocument();
    } finally {
      Intl.supportedValuesOf = originalSupportedValuesOf;
    }
  });
});

