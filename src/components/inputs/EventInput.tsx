import React from "react";
import { type EventData, CalendarProvider } from "../../types";
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

/** Common timezones pinned at the top of the timezone selector for quick access. */
export const COMMON_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (America/New_York)" },
  { value: "America/Chicago", label: "Central Time (America/Chicago)" },
  { value: "America/Denver", label: "Mountain Time (America/Denver)" },
  { value: "America/Los_Angeles", label: "Pacific Time (America/Los_Angeles)" },
  { value: "Europe/London", label: "London (Europe/London)" },
  { value: "Europe/Paris", label: "Paris (Europe/Paris)" },
  { value: "Europe/Berlin", label: "Berlin (Europe/Berlin)" },
  { value: "Asia/Tokyo", label: "Tokyo (Asia/Tokyo)" },
  { value: "Asia/Shanghai", label: "Shanghai (Asia/Shanghai)" },
  { value: "Asia/Kolkata", label: "Kolkata (Asia/Kolkata)" },
  { value: "Australia/Sydney", label: "Sydney (Australia/Sydney)" },
];

/** Fallback list of major IANA timezones used when Intl.supportedValuesOf is unavailable. */
export const FALLBACK_TIMEZONES = [
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

/**
 * Retrieves the list of supported standard IANA timezone identifiers.
 */
export function getSupportedTimezones(): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      // Fallback if Intl call fails
    }
  }
  return FALLBACK_TIMEZONES;
}

/**
 * Formats an IANA timezone identifier into a user-friendly label.
 * e.g., "Europe/Amsterdam" -> "Amsterdam (Europe/Amsterdam)"
 * "America/Indiana/Indianapolis" -> "Indiana - Indianapolis (America/Indiana/Indianapolis)"
 * "UTC" -> "UTC"
 */
export function formatTimezoneLabel(tz: string): string {
  if (tz === "UTC") return "UTC";

  const parts = tz.split("/");
  if (parts.length > 1) {
    const location = parts.slice(1).join(" - ").replace(/_/g, " ");
    return `${location} (${tz})`;
  }
  return tz;
}

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
  const [fullTimezones, setFullTimezones] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    setFullTimezones(getSupportedTimezones());
  }, []);

  const baseTimezones = fullTimezones || FALLBACK_TIMEZONES;

  const timezoneOptions = React.useMemo(() => {
    const baseZones = baseTimezones.filter((z) => z !== "UTC" && z !== "");
    if (data.timezone && data.timezone !== "UTC" && !baseZones.includes(data.timezone)) {
      return [...baseZones, data.timezone].sort();
    }
    return baseZones;
  }, [baseTimezones, data.timezone]);

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
          <optgroup label="Common">
            {COMMON_TIMEZONES.map((ctz) => (
              <option key={`common-${ctz.value}`} value={ctz.value}>
                {ctz.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="All Timezones">
            {timezoneOptions.map((tz) => (
              <option key={`all-${tz}`} value={tz}>
                {formatTimezoneLabel(tz)}
              </option>
            ))}
          </optgroup>
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
        placeholder="Event details…"
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
