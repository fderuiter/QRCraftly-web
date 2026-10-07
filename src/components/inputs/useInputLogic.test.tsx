import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useInputLogic, clearRetainedInputStates } from "./useInputLogic";
import { QRConfig, QRType, QRStyle, QRErrorCorrectionLevel, SocialFormat, TemplateStyle } from "../../types";

const createMockConfig = (type: QRType, value: string): QRConfig => ({
  value,
  type,
  fgColor: "#000000",
  bgColor: "#ffffff",
  style: QRStyle.STANDARD,
  logoUrl: null,
  logoSize: 0.15,
  logoPaddingStyle: "square",
  logoPadding: 1,
  logoBackgroundColor: "#ffffff",
  eyeColor: "#000000",
  errorCorrectionLevel: QRErrorCorrectionLevel.H,
  isBorderEnabled: false,
  borderSize: 0.05,
  borderColor: "#000000",
  borderStyle: "none" as any,
  borderText: "",
  borderTextPosition: "bottom" as any,
  borderTextColor: "#000000",
  borderLogoUrl: null,
  borderLogoPosition: "bottom-right" as any,
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
});

describe("useInputLogic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRetainedInputStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should synchronize state with a valid external value change", () => {
    const config = createMockConfig(QRType.TEXT, "Initial Text");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    expect(result.current.inputProps.data).toEqual({ text: "Initial Text" });

    // Update config externally with a new text value
    const updatedConfig = createMockConfig(QRType.TEXT, "External Change");
    rerender({ cfg: updatedConfig });

    expect(result.current.inputProps.data).toEqual({ text: "External Change" });
  });

  it("should reset visual text and internal state to initialState synchronously when external reset occurs (Issue A)", () => {
    const config = createMockConfig(QRType.TEXT, "Stale Text");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    expect(result.current.inputProps.data).toEqual({ text: "Stale Text" });

    // Simulate clearing / resetting the form externally
    const clearedConfig = createMockConfig(QRType.TEXT, "");
    rerender({ cfg: clearedConfig });

    // It should reset synchronously to initialState
    expect(result.current.inputProps.data).toEqual({ text: "" });
  });

  it("should cancel active input timers upon receiving an external configuration change, avoiding overwrite (Issue B)", () => {
    const config = createMockConfig(QRType.TEXT, "Original State");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // User types: the first edit after a quiet spell is written at once, the next one in the
    // same burst waits for the burst to pause
    act(() => {
      result.current.inputProps.onChange({ text: "User Typed" });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.inputProps.onChange({ text: "User Typed Something" });
    });

    // The state updates locally immediately
    expect(result.current.inputProps.data).toEqual({ text: "User Typed Something" });

    // Before debounce timer (100ms) fires, an external reset or change occurs
    const externalConfig = createMockConfig(QRType.TEXT, "Original State Restored");
    rerender({ cfg: externalConfig });

    // Advancing timers by 200ms
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Stale typed value must not overwrite the restored/external state
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(result.current.inputProps.data).toEqual({ text: "Original State Restored" });
  });

  it("should validate input locally and block onChange propagation if value is invalid (Issue C)", () => {
    // Let's test WifiInput with invalid SSID (control character)
    const config = createMockConfig(QRType.WIFI, "WIFI:T:WPA;S:MyWiFi;P:secret;;");
    const onChange = vi.fn();

    const { result } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // Initial SSID state
    expect((result.current.inputProps.data as any).ssid).toBe("MyWiFi");

    // Change to include invalid control character
    act(() => {
      result.current.inputProps.onChange({ ssid: "MyWiFi\u0001Network" });
    });

    // Advance timers by 200ms to trigger debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Validation should fail and prevent the onChange callback from propagating
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should validate URL input locally and block onChange propagation if URL is dangerous", () => {
    const config = createMockConfig(QRType.URL, "https://example.com");
    const onChange = vi.fn();

    const { result } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    expect((result.current.inputProps.data as any).url).toBe("https://example.com");

    // Change URL to a dangerous javascript URI
    act(() => {
      result.current.inputProps.onChange({ url: "javascript:alert(1)" });
    });

    // Advance timers by 200ms to trigger debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Validation should fail and prevent the onChange callback from propagating
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should preserve newly normalized URL state and push constructed value when swapping tabs", () => {
    const config = createMockConfig(QRType.URL, "http://google.com/");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // Initial state is normalized url
    expect((result.current.inputProps.data as any).url).toBe("http://google.com/");

    // Simulate tab swap: QRContext updates type to TEXT and value to empty string
    const textConfig = createMockConfig(QRType.TEXT, "");
    rerender({ cfg: textConfig });

    // The local state of URL should remain preserved in useInputLogic's inputStates under URL key,
    // and we should now be looking at TEXT state
    expect((result.current.inputProps.data as any).text).toBe("");

    // Simulate switching back to URL: QRContext updates type back to URL and value to empty string
    const backToUrlConfig = createMockConfig(QRType.URL, "");
    rerender({ cfg: backToUrlConfig });

    // It should detect the tab switch, preserve the local "http://google.com/" state, and push it back to the store
    expect(onChange).toHaveBeenCalledWith({ value: "http://google.com/" });
  });

  it("should preserve uncommitted form state across generator route remounts via volatile cache", () => {
    const onChange1 = vi.fn();
    const urlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");

    // Route 1 (URL generator): user types uncommitted text
    const { result: urlHook, unmount: unmountUrl } = renderHook(() => useInputLogic(urlConfig, onChange1));
    act(() => {
      urlHook.current.inputProps.onChange({ url: "https://example.com/retained" });
    });
    expect(urlHook.current.inputProps.data).toEqual({ url: "https://example.com/retained" });
    unmountUrl(); // User navigates away to another route

    // Route 2 (WiFi generator): mounts as a new route instance
    const onChange2 = vi.fn();
    const wifiConfig = createMockConfig(QRType.WIFI, "https://qrcraftly.com");
    const { result: wifiHook, unmount: unmountWifi } = renderHook(() => useInputLogic(wifiConfig, onChange2));
    act(() => {
      wifiHook.current.inputProps.onChange({ ssid: "MyOfficeWiFi", password: "SecretPassword" });
    });
    expect((wifiHook.current.inputProps.data as any).ssid).toBe("MyOfficeWiFi");
    unmountWifi(); // User navigates away from WiFi route

    // Route 3: User returns to URL generator route (which starts with default config)
    const onChange3 = vi.fn();
    const returnUrlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const { result: returnUrlHook } = renderHook(() => useInputLogic(returnUrlConfig, onChange3));

    // The returned hook should hydrate from retained input cache and push the constructed retained value
    expect(returnUrlHook.current.inputProps.data).toEqual({ url: "https://example.com/retained" });
    expect(onChange3).toHaveBeenCalledWith({ value: "https://example.com/retained" });
  });

  it("should preserve explicitly cleared empty state across route remounts", () => {
    const onChange1 = vi.fn();
    const urlConfig = createMockConfig(QRType.URL, "https://example.com");

    // Route 1 (URL generator): user clears the text
    const { result: urlHook, unmount: unmountUrl } = renderHook(() => useInputLogic(urlConfig, onChange1));
    act(() => {
      urlHook.current.inputProps.onChange({ url: "" });
    });
    expect(urlHook.current.inputProps.data).toEqual({ url: "" });
    unmountUrl();

    // Route 2: Return to URL route with default config
    const onChange2 = vi.fn();
    const defaultUrlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const { result: returnUrlHook } = renderHook(() => useInputLogic(defaultUrlConfig, onChange2));

    // Retained cache should preserve the explicitly cleared state ("")
    expect(returnUrlHook.current.inputProps.data).toEqual({ url: "" });
    expect(onChange2).toHaveBeenCalledWith({ value: "" });
  });

  it("should clear retained input states when clearRetainedInputStates is called", () => {
    const onChange1 = vi.fn();
    const urlConfig = createMockConfig(QRType.URL, "https://example.com");

    const { result: urlHook, unmount } = renderHook(() => useInputLogic(urlConfig, onChange1));
    act(() => {
      urlHook.current.inputProps.onChange({ url: "https://custom.org" });
    });
    unmount();

    // Clear module memory
    clearRetainedInputStates();

    // Re-mount with default config
    const onChange2 = vi.fn();
    const defaultUrlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const { result: freshHook } = renderHook(() => useInputLogic(defaultUrlConfig, onChange2));

    // Should fall back to default initial state rather than old custom value
    expect(freshHook.current.inputProps.data).toEqual({ url: "https://qrcraftly.com" });
  });

  it("should prepopulate non-URL types with sample input values and emit constructed sample payload on tab switch", () => {
    const config = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // Swap tab to WiFi with an empty config value (simulating tab switch)
    const wifiConfig = createMockConfig(QRType.WIFI, "");
    rerender({ cfg: wifiConfig });

    // Expect initial state for WiFi to be populated with sample data
    expect((result.current.inputProps.data as any).ssid).toBe("QRCraftly_Guest");
    expect((result.current.inputProps.data as any).password).toBe("examplepass123");
    // Expect onChange to be called with the constructed sample payload
    expect(onChange).toHaveBeenCalledWith({ value: "WIFI:T:WPA;S:QRCraftly_Guest;P:examplepass123;;" });

    // Swap tab to VCARD with an empty config value
    const vCardConfig = createMockConfig(QRType.VCARD, "");
    rerender({ cfg: vCardConfig });

    expect((result.current.inputProps.data as any).firstName).toBe("Jane");
    expect((result.current.inputProps.data as any).organization).toBe("QRCraftly");
    expect(onChange).toHaveBeenLastCalledWith({
      value: expect.stringContaining("BEGIN:VCARD"),
    });
  });

  it("should preserve explicitly cleared empty non-URL input state across route remounts without overwriting with sample defaults", () => {
    const onChange1 = vi.fn();
    const wifiConfig = createMockConfig(QRType.WIFI, "WIFI:T:WPA;S:QRCraftly_Guest;P:examplepass123;;");

    // Route 1 (WiFi generator): user clears all input fields
    const { result: wifiHook, unmount: unmountWifi } = renderHook(() => useInputLogic(wifiConfig, onChange1));
    act(() => {
      wifiHook.current.inputProps.onChange({ ssid: "", password: "" });
    });
    unmountWifi();

    // Route 2: Return to WiFi route with default / empty config
    const onChange2 = vi.fn();
    const returnWifiConfig = createMockConfig(QRType.WIFI, "");
    const { result: returnWifiHook } = renderHook(() => useInputLogic(returnWifiConfig, onChange2));

    // Retained cache should preserve the explicitly cleared state ("")
    expect((returnWifiHook.current.inputProps.data as any).ssid).toBe("");
    expect((returnWifiHook.current.inputProps.data as any).password).toBe("");
  });
});

describe("useInputLogic flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRetainedInputStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a pending debounced edit immediately and only once", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useInputLogic(createMockConfig(QRType.TEXT, ""), onChange));

    const type = (text: string) =>
      act(() => {
        (result.current.inputProps as { onChange: (u: { text: string }) => void }).onChange({ text });
      });
    type("t");
    expect(onChange).toHaveBeenCalledTimes(1);
    type("typed");
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.flush();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ value: "typed" });

    act(() => {
      vi.advanceTimersByTime(200);
      result.current.flush();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no edit is pending", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useInputLogic(createMockConfig(QRType.TEXT, "x"), onChange));
    act(() => {
      result.current.flush();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
