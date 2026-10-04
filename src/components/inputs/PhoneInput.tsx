import React from "react";
import { PhoneData } from "../../types";
import { TextField } from "../ui/FormFields";
import { FieldNotes, hintsId } from "./FieldHints";

/** A leading or trailing `*` or `#` makes the number a dialer (USSD) code. */
export const USSD_NOTE =
  "This looks like a dialer code (USSD), not a phone number. Codes like this can change phone settings or move money, so only use it if you trust the people who will scan it.";

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
        maxLength={20}
        placeholder="+1 555 000 0000"
        value={data.number}
        onChange={(e) => onChange({ number: e.target.value })}
        aria-describedby={hintsId("phone-number")}
      />
      <FieldNotes fieldId="phone-number" notes={/^\s*[*#]|[*#]\s*$/.test(data.number) ? [USSD_NOTE] : []} />
    </div>
  );
};
