import React, { useState } from "react";
import { Button } from "../ui/Button";
import { LocationData } from "../../types";
import { TextField } from "../ui/FormFields";
import { FormBlock } from "../ui/FormBlock";
import { announcePolitely } from "../../utils/a11y";
import { coordinateError } from "@/packages/qr-payload";

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

export const LocationInput: React.FC<LocationInputProps> = ({
  data,
  onChange,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLoading(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
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
        id="location-latitude"
        label="Latitude"
        type="text"
        inputMode="decimal"
        placeholder="-90 to 90 (e.g. 40.7128)"
        maxLength={20}
        value={data.latitude}
        onChange={(e) => onChange({ latitude: e.target.value })}
        error={coordinateError(data.latitude, "latitude") ?? undefined}
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
        onChange={(e) => onChange({ longitude: e.target.value })}
        error={coordinateError(data.longitude, "longitude") ?? undefined}
      />
      <Button
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
        <p role="alert" className="text-xs text-danger">
          {geoError}
        </p>
      )}
    </FormBlock>
  );
};
