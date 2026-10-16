import React from "react";
import type { EmailData } from "../../types";
import { TextField, TextAreaField } from "../ui/FormFields";
import { CONTAINER_SPACING_CLASSES } from "../ui/styles";
import { emailListError } from "@/packages/qr-payload";

interface EmailInputProps {
  data: EmailData;
  onChange: (updates: Partial<EmailData>) => void;
}

export const EmailInput: React.FC<EmailInputProps> = ({ data, onChange }) => {
  const hasOtherContent = Boolean(
    data.cc?.trim() || data.bcc?.trim() || data.subject?.trim() || data.body?.trim()
  );

  const emailError = emailListError(data.email, { required: hasOtherContent }) ?? undefined;
  const ccError = emailListError(data.cc) ?? undefined;
  const bccError = emailListError(data.bcc) ?? undefined;

  return (
    <div className={CONTAINER_SPACING_CLASSES}>
      <TextField
        id="email-address"
        name="email"
        label="Email Address"
        autoComplete="email"
        type="email"
        placeholder="name@example.com"
        maxLength={254}
        value={data.email}
        onChange={(e) => onChange({ email: e.target.value })}
        error={emailError}
      />
      <TextField
        id="email-cc"
        name="cc"
        label="CC"
        type="text"
        placeholder="cc@example.com"
        maxLength={254}
        value={data.cc || ""}
        onChange={(e) => onChange({ cc: e.target.value })}
        error={ccError}
      />
      <TextField
        id="email-bcc"
        name="bcc"
        label="BCC"
        type="text"
        placeholder="bcc@example.com"
        maxLength={254}
        value={data.bcc || ""}
        onChange={(e) => onChange({ bcc: e.target.value })}
        error={bccError}
      />
      <TextField
        id="email-subject"
        label="Subject"
        type="text"
        placeholder="e.g. Invitation"
        maxLength={200}
        value={data.subject}
        onChange={(e) => onChange({ subject: e.target.value })}
        showCharCount
      />
      <TextAreaField
        id="email-body"
        label="Body"
        rows={3}
        placeholder="Write your message here…"
        maxLength={2000}
        value={data.body}
        onChange={(e) => onChange({ body: e.target.value })}
        showCharCount
      />
    </div>
  );
};
