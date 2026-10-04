import React, { useMemo, useEffect, useRef } from "react";
import { MeetingData, QRType } from "../../types";
import { describeViolation } from "@/packages/qr-payload";
import { findBlockingViolation } from "./linkViolations";
import { TextField } from "../ui/FormFields";
import { LinkHints, hintsId } from "./FieldHints";
import { parseMeetingUrl } from "../../utils/meetingParsers";
import { FormBlock } from "../ui/FormBlock";
import { announcePolitely } from "../../utils/a11y";

interface MeetingInputProps {
  data: MeetingData;
  onChange: (updates: Partial<MeetingData>) => void;
}

const SERVICE_LABELS: Record<string, string> = {
  zoom: "Zoom",
  teams: "Microsoft Teams",
  meet: "Google Meet",
};

export const MeetingInput: React.FC<MeetingInputProps> = ({
  data,
  onChange,
}) => {
  const parsed = useMemo(() => parseMeetingUrl(data.url), [data.url]);
  const lastAnnouncedServiceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data.url || parsed.service === 'unknown') {
      lastAnnouncedServiceRef.current = null;
      return;
    }

    if (parsed.service !== lastAnnouncedServiceRef.current) {
      const serviceLabel = SERVICE_LABELS[parsed.service];
      if (serviceLabel) {
        announcePolitely(`${serviceLabel} detected`);
        lastAnnouncedServiceRef.current = parsed.service;
      }
    }
  }, [parsed.service, data.url]);

  const violation = findBlockingViolation(QRType.MEETING, data);

  const serviceLabel =
    parsed.service !== "unknown" ? SERVICE_LABELS[parsed.service] : null;

  return (
    <FormBlock legend="Meeting Link">
      <TextField
        id="meeting-url"
        label="Paste Meeting Link"
        type="text"
        placeholder="https://zoom.us/j/... or teams.microsoft.com/..."
        value={data.url}
        onChange={(e) => onChange({ url: e.target.value })}
        error={violation ? describeViolation(violation) : undefined}
        aria-describedby={hintsId("meeting-url")}
      />
      {!violation && <LinkHints fieldId="meeting-url" address={data.url} />}

      {data.url && parsed.service !== "unknown" && (
        <div className="space-y-1 rounded-lg border border-line bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
          {serviceLabel && (
            <p className="font-semibold text-accent">
              {serviceLabel} link detected
            </p>
          )}
          {parsed.meetingId && (
            <p className="text-fg-muted">
              <span className="font-medium">Meeting ID:</span>{" "}
              {parsed.meetingId}
            </p>
          )}
          {parsed.passcode && (
            <p className="text-fg-muted">
              <span className="font-medium">Passcode:</span> {parsed.passcode}
            </p>
          )}
        </div>
      )}
    </FormBlock>
  );
};
