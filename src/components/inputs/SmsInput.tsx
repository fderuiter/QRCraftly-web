import React from "react";
import type { SmsData } from "../../types";
import { TextField, TextAreaField } from "../ui/FormFields";
import { CONTAINER_SPACING_CLASSES } from "../ui/styles";
import { FieldNotes, hintsId } from "./FieldHints";
import { droppedPhoneCharacters } from "@/packages/qr-payload";

/** Notes about the number field: a code that texts several people, or a short paid number. */
export function smsNumberNotes(number: string): string[] {
  const numbers = number.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean);
  const notes: string[] = [];
  if (numbers.length > 1) notes.push(`Anyone who scans this will text ${numbers.length} numbers at once.`);
  if (numbers.some((entry) => /^\d{3,6}$/.test(entry))) notes.push("A short number like this can be a paid service, and scanners may be charged.");
  const dropped = droppedPhoneCharacters(number, true);
  if (dropped.length > 0) {
    notes.push(`The code leaves out ${dropped.map((ch) => `"${ch}"`).join(", ")}, so only the digits are texted. Text messages cannot reach an extension.`);
  }
  return notes;
}

interface SmsInputProps {
  data: SmsData;
  onChange: (updates: Partial<SmsData>) => void;
}

export const SmsInput: React.FC<SmsInputProps> = ({ data, onChange }) => {
  return (
    <div className={CONTAINER_SPACING_CLASSES}>
      <TextField
        id="sms-number"
        name="phone"
        label="Phone Number"
        autoComplete="tel"
        type="tel"
        maxLength={500}
        placeholder="+1 555 000 0000"
        value={data.number}
        onChange={(e) => onChange({ number: e.target.value })}
        aria-describedby={hintsId("sms-number")}
      />
      <FieldNotes fieldId="sms-number" notes={smsNumberNotes(data.number)} />
      <TextAreaField
        id="sms-message"
        label="Pre-filled Message"
        rows={3}
        maxLength={1600}
        placeholder="Type your SMS message here..."
        value={data.message}
        onChange={(e) => onChange({ message: e.target.value })}
        showCharCount
      />
    </div>
  );
};
