import React from "react";
import { EventData, CalendarProvider } from "../../types";
import { TextField, TextAreaField, SelectField } from "../ui/FormFields";
import { LinkHints, firstWebAddress, hintsId } from "./FieldHints";
import { CONTAINER_SPACING_CLASSES } from "../ui/styles";

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
      >
        <option value={CalendarProvider.ICAL}>iCalendar (.ics)</option>
        <option value={CalendarProvider.GOOGLE}>Google Calendar</option>
        <option value={CalendarProvider.OUTLOOK}>Outlook Web</option>
        <option value={CalendarProvider.OFFICE365}>Office 365</option>
        <option value={CalendarProvider.YAHOO}>Yahoo Calendar</option>
      </SelectField>
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
      <TextField
        id="event-start-date"
        label="Start Date & Time"
        type="datetime-local"
        value={data.startDate}
        onChange={(e) => onChange({ startDate: e.target.value })}
      />
      <TextField
        id="event-end-date"
        label="End Date & Time"
        type="datetime-local"
        value={data.endDate}
        onChange={(e) => onChange({ endDate: e.target.value })}
      />
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
