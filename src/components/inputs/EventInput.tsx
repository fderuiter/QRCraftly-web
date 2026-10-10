import React from "react";
import { EventData, CalendarProvider } from "../../types";
import { TextField, TextAreaField, SelectField } from "../ui/FormFields";
import { FieldNotes, LinkHints, firstWebAddress, hintsId } from "./FieldHints";
import { CONTAINER_SPACING_CLASSES } from "../ui/styles";
import { ToggleSwitch } from "../ui/ToggleSwitch";

/** Provider names for the web-calendar notice. */
const WEB_CALENDAR_OWNERS: Partial<Record<string, string>> = {
  [CalendarProvider.GOOGLE]: "Google",
  [CalendarProvider.OUTLOOK]: "Microsoft",
  [CalendarProvider.OFFICE365]: "Microsoft",
  [CalendarProvider.YAHOO]: "Yahoo",
};

/**
 * The notice under the calendar choice: a web calendar code is a link, so the provider receives
 * the event details when someone opens it (#1364).
 * @param provider - The chosen calendar.
 * @returns The notice, or nothing for iCalendar.
 */
export function webCalendarNotes(provider: string | undefined): string[] {
  const owner = provider ? WEB_CALENDAR_OWNERS[provider] : undefined;
  if (!owner) return [];
  return [`This code is a link to ${owner}. Whoever scans and opens it sends the event's title, times, location and description to ${owner}. Choose iCalendar to keep the event inside the code.`];
}

/**
 * Switches the event between timed and all-day, keeping the chosen days.
 * @param data - The event as it stands.
 * @param allDay - Whether the event becomes all-day.
 * @returns The fields to update.
 */
export function toggleAllDay(data: EventData, allDay: boolean): Partial<EventData> {
  const day = (value: string): string => value.slice(0, 10);
  if (allDay) return { allDay, startDate: day(data.startDate), endDate: day(data.endDate) };
  return {
    allDay,
    startDate: data.startDate ? `${day(data.startDate)}T09:00` : "",
    endDate: data.endDate ? `${day(data.endDate)}T10:00` : "",
  };
}

interface EventInputProps {
  data: EventData;
  onChange: (updates: Partial<EventData>) => void;
}

export const EventInput: React.FC<EventInputProps> = ({ data, onChange }) => {
  return (
    <div className={CONTAINER_SPACING_CLASSES}>
      <SelectField
        id="event-provider"
        label="Target Calendar"
        value={data.provider || CalendarProvider.ICAL}
        onChange={(e) => onChange({ provider: e.target.value as CalendarProvider })}
        aria-describedby={hintsId("event-provider")}
      >
        <option value={CalendarProvider.ICAL}>iCalendar (.ics)</option>
        <option value={CalendarProvider.GOOGLE}>Google Calendar</option>
        <option value={CalendarProvider.OUTLOOK}>Outlook Web</option>
        <option value={CalendarProvider.OFFICE365}>Office 365</option>
        <option value={CalendarProvider.YAHOO}>Yahoo Calendar</option>
      </SelectField>
      <FieldNotes fieldId="event-provider" notes={webCalendarNotes(data.provider)} />
      <TextField
        id="event-title"
        label="Event Title"
        type="text"
        placeholder="e.g. Birthday Party"
        maxLength={200}
        value={data.title}
        onChange={(e) => onChange({ title: e.target.value })}
        showCharCount
      />
      <ToggleSwitch
        id="event-all-day"
        label="All-day event"
        checked={Boolean(data.allDay)}
        onChange={(allDay) => onChange(toggleAllDay(data, allDay))}
      />
      <TextField
        id="event-start-date"
        label={data.allDay ? "Start Date" : "Start Date & Time"}
        type={data.allDay ? "date" : "datetime-local"}
        value={data.startDate}
        onChange={(e) => onChange({ startDate: e.target.value })}
      />
      <TextField
        id="event-end-date"
        label={data.allDay ? "Last Day" : "End Date & Time"}
        type={data.allDay ? "date" : "datetime-local"}
        value={data.endDate}
        onChange={(e) => onChange({ endDate: e.target.value })}
      />
      {!data.allDay && (
      <SelectField
        id="event-timezone"
        label="Timezone"
        value={data.timezone || ""}
        onChange={(e) => onChange({ timezone: e.target.value })}
      >
        <option value="">Floating / Local Time</option>
        <option value="UTC">UTC</option>
        <option value="America/New_York">Eastern Time (America/New_York)</option>
        <option value="America/Chicago">Central Time (America/Chicago)</option>
        <option value="America/Denver">Mountain Time (America/Denver)</option>
        <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
        <option value="Europe/London">London (Europe/London)</option>
        <option value="Europe/Paris">Paris (Europe/Paris)</option>
        <option value="Europe/Berlin">Berlin (Europe/Berlin)</option>
        <option value="Asia/Tokyo">Tokyo (Asia/Tokyo)</option>
        <option value="Asia/Shanghai">Shanghai (Asia/Shanghai)</option>
        <option value="Asia/Kolkata">Kolkata (Asia/Kolkata)</option>
        <option value="Australia/Sydney">Sydney (Australia/Sydney)</option>
      </SelectField>
      )}
      <TextField
        id="event-location"
        label="Location"
        type="text"
        placeholder="e.g. 123 Main St, City"
        maxLength={300}
        value={data.location}
        onChange={(e) => onChange({ location: e.target.value })}
        aria-describedby={hintsId("event-location")}
        showCharCount
      />
      <LinkHints fieldId="event-location" address={firstWebAddress(data.location)} />
      <TextAreaField
        id="event-description"
        label="Description"
        rows={3}
        placeholder="Event details..."
        maxLength={2000}
        value={data.description}
        onChange={(e) => onChange({ description: e.target.value })}
        aria-describedby={hintsId("event-description")}
        showCharCount
      />
      <LinkHints fieldId="event-description" address={firstWebAddress(data.description)} />
    </div>
  );
};
