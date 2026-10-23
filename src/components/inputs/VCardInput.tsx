import React, { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import type { VCardData } from "../../types";
import { TextField, SelectField } from "../ui/FormFields";
import { LinkHints, hintsId } from "./FieldHints";
import {
  vCardFieldError,
  VCARD_SOCIAL_FIELDS,
  VCARD_SOCIAL_NETWORKS,
} from "@/packages/qr-payload";
import { FormBlock } from "../ui/FormBlock";
import { Button } from "../ui/Button";
import { announcePolitely } from "../../utils/a11y";
import {
  GRID_TWO_COLUMNS_CLASSES,
  SUB_CONTAINER_SPACING_CLASSES,
} from "../ui/styles";

export interface VCardInputProps {
  data: VCardData;
  onChange: (updates: Partial<VCardData>) => void;
}

const MAX_FILE_SIZE = 256 * 1024;

export const VCardInput: React.FC<VCardInputProps> = ({ data, onChange }) => {
  const err = (field: keyof VCardData) => vCardFieldError(field, data[field]);
  const set = (field: keyof VCardData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ [field]: e.target.value });

  // A half-typed profile link is not yet on its network's host, so its error waits for blur (#1435).
  const [blurredSocials, setBlurredSocials] = useState<ReadonlySet<string>>(() => new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMeCard = data.version === "mecard";

  const processFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setFileError("File size exceeds 256 KB limit.");
      return;
    }

    const text = (await file.text().catch(() => "")).trim();
    const isVCard = /begin:vcard/i.test(text);
    const isMECard = /^mecard:/i.test(text);

    if (!isVCard && !isMECard) {
      setFileError("Invalid vCard file. Missing BEGIN:VCARD header.");
      return;
    }

    const { hydrateVCardData } = await import("@/packages/qr-payload");
    const hydrated = hydrateVCardData(text);
    const updates: Partial<VCardData> = {};
    for (const key in hydrated) {
      if (key !== "version") {
        const val = hydrated[key as keyof VCardData];
        if (typeof val === "string" && val.trim()) {
          (updates as Record<string, string>)[key] = val;
        }
      }
    }

    if (isMECard) {
      updates.version = "mecard";
    } else if (/VERSION:(2\.1|3\.0|4\.0)/i.test(text)) {
      updates.version = hydrated.version as VCardData["version"];
    }

    if (Object.keys(updates).length > 0) {
      setFileError(null);
      onChange(updates);
      announcePolitely("vCard contact details imported");
    } else {
      setFileError("No contact details found in vCard file.");
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  return (
    <FormBlock legend="Contact Details (vCard)">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vcf,.vcard"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Upload vCard file"
        />
        <Button
          type="button"
          variant="dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-dragover={isDragging ? "" : undefined}
          className="group"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-hover transition-colors group-hover:bg-accent-soft">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </span>
          <span className="text-sm font-medium">Import .vcf or .vcard file</span>
          <span className="text-xs text-fg-muted">
            Drag & drop or select a vCard file
          </span>
        </Button>
        {fileError && (
          <div
            role="alert"
            aria-live="polite"
            className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger"
          >
            <span>{fileError}</span>
            <button
              type="button"
              onClick={() => setFileError(null)}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-danger hover:opacity-80 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              aria-label="Dismiss alert"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <SelectField
        id="vcard-version"
        label="Contact Format"
        value={data.version || "3.0"}
        onChange={set("version") as (e: ChangeEvent<HTMLSelectElement>) => void}
      >
        <option value="3.0">vCard 3.0 (Standard)</option>
        <option value="4.0">vCard 4.0 (Modern RFC 6350)</option>
        <option value="2.1">vCard 2.1 (Legacy)</option>
        <option value="mecard">MECard (Compact / NTT DoCoMo)</option>
      </SelectField>

      <div className={GRID_TWO_COLUMNS_CLASSES}>
        <TextField
          id="vcard-firstname"
          name="firstName"
          label="First Name"
          autoComplete="given-name"
          maxLength={100}
          placeholder="e.g. Jane"
          value={data.firstName}
          onChange={set("firstName")}
          error={err("firstName")}
        />
        <TextField
          id="vcard-lastname"
          name="lastName"
          label="Last Name"
          autoComplete="family-name"
          maxLength={100}
          placeholder="e.g. Doe"
          value={data.lastName}
          onChange={set("lastName")}
          error={err("lastName")}
        />
      </div>

      <div className={GRID_TWO_COLUMNS_CLASSES}>
        <TextField
          id="vcard-phone"
          name="phone"
          label="Mobile Phone"
          autoComplete="tel"
          type="tel"
          maxLength={20}
          placeholder="+1 555 000 0000"
          value={data.phone}
          onChange={set("phone")}
          error={err("phone")}
        />
        <TextField
          id="vcard-email"
          name="email"
          label="Email"
          autoComplete="email"
          type="email"
          maxLength={254}
          placeholder="name@example.com"
          value={data.email}
          onChange={set("email")}
          error={err("email")}
        />
      </div>

      <TextField
        id="vcard-org"
        name="organization"
        label="Company / Organization"
        autoComplete="organization"
        maxLength={100}
        placeholder="e.g. Acme Corp"
        value={data.organization}
        onChange={set("organization")}
        error={err("organization")}
      />

      <TextField
        id="vcard-title"
        name="title"
        label="Job Title"
        autoComplete="organization-title"
        maxLength={100}
        placeholder="e.g. Software Engineer"
        value={data.title}
        onChange={set("title")}
        error={err("title")}
      />

      <TextField
        id="vcard-website"
        name="website"
        label="Website"
        autoComplete="url"
        type="url"
        maxLength={2048}
        placeholder="https://example.com"
        value={data.website}
        onChange={set("website")}
        error={err("website")}
        aria-describedby={hintsId("vcard-website")}
      />
      {!err("website") && <LinkHints fieldId="vcard-website" address={data.website} />}

      {!isMeCard && (
        <>
          <TextField
            id="vcard-photo"
            name="photo"
            label="Profile Photo URL"
            autoComplete="url"
            type="url"
            maxLength={2048}
            placeholder="https://example.com/avatar.jpg"
            value={data.photo || ""}
            onChange={set("photo")}
            error={err("photo")}
            aria-describedby={hintsId("vcard-photo")}
          />
          <p className="mt-1 text-xs text-fg-muted">Some phones don't load linked photos.</p>
          {!err("photo") && <LinkHints fieldId="vcard-photo" address={data.photo || ""} />}
        </>
      )}

      <FormBlock legend="Social Profiles" isSubFieldset={true}>
        {isMeCard ? (
          <p className="text-xs text-fg-muted">Social profiles are saved in vCard formats only. MECard leaves them out.</p>
        ) : (
          <div className={GRID_TWO_COLUMNS_CLASSES}>
            {VCARD_SOCIAL_FIELDS.map((field) => {
              const network = VCARD_SOCIAL_NETWORKS[field];
              return (
                <TextField
                  key={field}
                  id={`vcard-${field}`}
                  name={field}
                  label={network.name}
                  contextualLabel="Optional"
                  autoComplete="off"
                  maxLength={2048}
                  placeholder={`@user or ${network.hosts[0]}/…`}
                  value={data[field] || ""}
                  onChange={set(field)}
                  onBlur={() => setBlurredSocials((prev) => new Set(prev).add(field))}
                  error={blurredSocials.has(field) ? err(field) : undefined}
                />
              );
            })}
          </div>
        )}
      </FormBlock>

      <FormBlock legend="Address" isSubFieldset={true}>
        <div className={SUB_CONTAINER_SPACING_CLASSES}>
          <TextField
            id="vcard-street"
            name="street"
            label="Street"
            autoComplete="street-address"
            maxLength={100}
            placeholder="Street"
            value={data.street}
            onChange={set("street")}
            error={err("street")}
          />
          <div className={GRID_TWO_COLUMNS_CLASSES}>
            <TextField
              id="vcard-city"
              name="city"
              label="City"
              autoComplete="address-level2"
              maxLength={100}
              placeholder="City"
              value={data.city}
              onChange={set("city")}
              error={err("city")}
            />
            <TextField
              id="vcard-zip"
              name="zip"
              label="ZIP / Postal Code"
              autoComplete="postal-code"
              maxLength={20}
              placeholder="ZIP"
              value={data.zip}
              onChange={set("zip")}
              error={err("zip")}
            />
            <TextField
              id="vcard-country"
              name="country"
              label="Country"
              autoComplete="country-name"
              maxLength={100}
              placeholder="Country"
              value={data.country}
              onChange={set("country")}
              error={err("country")}
            />
          </div>
        </div>
      </FormBlock>
    </FormBlock>
  );
};
