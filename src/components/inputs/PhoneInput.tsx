import React from "react";
import type { PhoneData } from "../../types";
import { TextField } from "../ui/FormFields";
import { FieldNotes, hintsId } from "./FieldHints";
import { droppedPhoneCharacters } from "@/packages/qr-payload";

/** A leading or trailing `*` or `#` makes the number a dialer (USSD) code. */
export const USSD_NOTE =
  "This looks like a dialer code (USSD), not a phone number. Codes like this can change phone settings or move money, so only use it if you trust the people who will scan it.";

/**
 * Says which typed characters the code leaves out, so letters are not silently dropped (#1277).
 * @param dropped - The characters left out.
 * @returns The note, or nothing when every character is kept.
 */
export function droppedCharactersNote(dropped: readonly string[]): string[] {
  if (dropped.length === 0) return [];
  const list = dropped.map((ch) => `"${ch}"`).join(", ");
  return [`The code leaves out ${list}, so only the digits are dialled. Write an extension as "ext. 123" at the end.`];
}

interface PhoneInputProps {
  data: PhoneData;
  onChange: (updates: Partial<PhoneData>) => void;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({ data, onChange }) => {
  return (
    <div>
      <TextField
        id="phone-number"
        name="phone"
        label="Phone Number"
        autoComplete="tel"
        type="tel"
        maxLength={32}
        placeholder="+1 555 000 0000"
        value={data.number}
        onChange={(e) => onChange({ number: e.target.value })}
        aria-describedby={hintsId("phone-number")}
      />
      <FieldNotes
        fieldId="phone-number"
        notes={[...(/^\s*[*#]|[*#]\s*$/.test(data.number) ? [USSD_NOTE] : []), ...droppedCharactersNote(droppedPhoneCharacters(data.number))]}
      />
    </div>
  );
};
