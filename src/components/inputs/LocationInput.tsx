import React, { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Alert } from "../ui/Alert";
import type { LocationData } from "@/packages/qr-payload";
import { TextField } from "../ui/FormFields";
import { FormBlock } from "../ui/FormBlock";
import { announcePolitely } from "../../utils/a11y";
import { coordinateError } from "@/packages/qr-payload";
import type { ParsedCoordinates } from "../../utils/locationParsers";

let cachedParseLocationUrl: ((input: string) => ParsedCoordinates | null) | null = null;

const getParseLocationUrl = async () => {
  if (cachedParseLocationUrl) return cachedParseLocationUrl;
  const mod = await import("../../utils/locationParsers");
  cachedParseLocationUrl = mod.parseLocationUrl;
  return cachedParseLocationUrl;
};

interface LocationInputProps {
  data: LocationData;
  onChange: (updates: Partial<LocationData>) => void;
}

/** Human-readable messages for GeolocationPositionError codes. */
const GEOLOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: "Location access denied. Please allow location permission in your browser.",
  2: "Location unavailable. Your device could not determine its position.",
  3: "Location request timed out. Please try again.",
};

/** A sign, a dot or digits ending in a dot: still being typed, so not wrong yet. */
const isUnfinishedNumber = (value: string): boolean => /^[+-]?\d*\.?$/.test(value.trim());

/**
 * The coordinate's message for the field: shown at once for a value that cannot become valid,
 * and only after the field is left for one that is still half typed.
 */
const shownCoordinateError = (value: string, axis: "latitude" | "longitude", left: boolean): string | undefined =>
  !left && isUnfinishedNumber(value) ? undefined : (coordinateError(value, axis) ?? undefined);

/**
 * High-accuracy coordinate form taking latitude and longitude in degrees or a pasted Google Maps URL / location string.
 */
export const LocationInput: React.FC<LocationInputProps> = ({
  data,
  onChange,
}) => {
  const [mapUrl, setMapUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const locationButtonRef = useRef<HTMLButtonElement>(null);
  const [latitudeLeft, setLatitudeLeft] = useState(false);
  const [longitudeLeft, setLongitudeLeft] = useState(false);
  // A position that arrives after the form is gone must not rewrite the form it no longer shows.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    void getParseLocationUrl();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lastProcessedUrlRef = useRef<string | null>(null);

  const clearErrors = () => {
    setGeoError(null);
    setUrlError(null);
  };

  const runParseUrl = (input: string, callback: (parsed: ParsedCoordinates | null) => void) => {
    if (cachedParseLocationUrl) {
      callback(cachedParseLocationUrl(input));
    } else {
      void getParseLocationUrl().then((parseFn) => {
        if (mountedRef.current) {
          callback(parseFn(input));
        }
      });
    }
  };

  const processUrlInput = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      clearErrors();
      lastProcessedUrlRef.current = null;
      return;
    }
    if (trimmed === lastProcessedUrlRef.current) {
      return;
    }
    clearErrors();
    runParseUrl(trimmed, (parsed) => {
      lastProcessedUrlRef.current = trimmed;
      if (parsed) {
        setUrlError(null);
        onChange({ latitude: parsed.latitude, longitude: parsed.longitude });
        announcePolitely("Location coordinates populated");
      } else {
        setUrlError("Could not extract valid coordinates from the provided URL or location string.");
      }
    });
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMapUrl(value);
    clearErrors();
    lastProcessedUrlRef.current = null;
  };

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");
    if (pastedText) {
      e.preventDefault();
      setMapUrl(pastedText);
      processUrlInput(pastedText);
    }
  };

  const handleUrlBlur = () => {
    if (mapUrl.trim()) {
      processUrlInput(mapUrl);
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (mapUrl.trim()) {
        processUrlInput(mapUrl);
      }
    }
  };

  const handleDismissError = () => {
    setGeoError(null);
    locationButtonRef.current?.focus();
  };

  const handleLatitudeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    clearErrors();
    onChange({ latitude: e.target.value });
  };

  const handleLongitudeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    clearErrors();
    onChange({ longitude: e.target.value });
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLoading(true);
    clearErrors();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mountedRef.current) return;
        setIsLoading(false);
        setGeoError(null);
        // Rounded to six decimals (about 10 cm), so `String()` never writes exponent form.
        const plain = (degrees: number) => String(Number(degrees.toFixed(6)));
        onChange({
          latitude: plain(position.coords.latitude),
          longitude: plain(position.coords.longitude),
        });
        announcePolitely("Location coordinates populated");
      },
      (err) => {
        if (!mountedRef.current) return;
        setIsLoading(false);
        setGeoError(
          GEOLOCATION_ERROR_MESSAGES[err.code] ??
            "An unknown error occurred while fetching location.",
        );
      },
      { timeout: 10000 },
    );
  };

  return (
    <FormBlock legend="Geo-Location">
      <TextField
        id="location-url"
        label="Google Maps Link or Coordinates"
        type="text"
        placeholder="Paste Google Maps link, geo: URI, or coordinates"
        maxLength={2048}
        value={mapUrl}
        onChange={handleUrlChange}
        onPaste={handleUrlPaste}
        onBlur={handleUrlBlur}
        onKeyDown={handleUrlKeyDown}
        error={urlError ?? undefined}
      />
      <TextField
        id="location-latitude"
        label="Latitude"
        type="text"
        inputMode="decimal"
        placeholder="-90 to 90 (e.g. 40.7128)"
        maxLength={20}
        value={data.latitude}
        onChange={handleLatitudeChange}
        onBlur={() => setLatitudeLeft(true)}
        error={shownCoordinateError(data.latitude, "latitude", latitudeLeft)}
      />
      <TextField
        id="location-longitude"
        label="Longitude"
        type="text"
        inputMode="decimal"
        placeholder="-180 to 180 (e.g. -74.0060)"
        maxLength={21}
        // Longitude has one extra character vs latitude because it has 3 integer digits
        // (-180) versus latitude's 2 (-90), requiring one more character for the sign+digits.
        value={data.longitude}
        onChange={handleLongitudeChange}
        onBlur={() => setLongitudeLeft(true)}
        error={shownCoordinateError(data.longitude, "longitude", longitudeLeft)}
      />
      <Button
        ref={locationButtonRef}
        type="button"
        variant="secondary"
        onClick={handleGetCurrentLocation}
        disabled={isLoading}
        aria-busy={isLoading}
        size="sm"
        fullWidth
        data-testid="use-current-location"
      >
        {isLoading ? "Fetching location…" : "Use Current Location"}
      </Button>
      {geoError && (
        <Alert variant="error" onDismiss={handleDismissError}>
          {geoError}
        </Alert>
      )}
    </FormBlock>
  );
};
