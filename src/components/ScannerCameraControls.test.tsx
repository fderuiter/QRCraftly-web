import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../tests/utils/axe';
import type { CameraInfo } from '@/packages/optical-scanner/client';
import { ScannerCameraControls } from './ScannerCameraControls';

const camera = (overrides: Partial<CameraInfo> = {}): CameraInfo => ({
  deviceId: 'back',
  facing: 'environment',
  width: 1920,
  height: 1080,
  frameRate: 30,
  torch: { supported: false, on: false },
  zoom: null,
  ...overrides,
});

const cameras = [
  { deviceId: 'back', label: 'Back camera' },
  { deviceId: 'front', label: '' },
];

function setPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: coarse, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
}

describe('ScannerCameraControls (#1100)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing when the camera offers no controls', () => {
    const { container } = render(
      <ScannerCameraControls camera={camera()} cameras={[cameras[0]]} onSwitchCamera={vi.fn()} onTorch={vi.fn()} onZoom={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists cameras on a mouse pointer and switches on choice', async () => {
    setPointer(false);
    const onSwitchCamera = vi.fn();
    const { container } = render(
      <ScannerCameraControls camera={camera()} cameras={cameras} onSwitchCamera={onSwitchCamera} onTorch={vi.fn()} onZoom={vi.fn()} />
    );
    const select = screen.getByLabelText('Camera');
    expect(screen.getByRole('option', { name: 'Camera 2' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'front' } });
    expect(onSwitchCamera).toHaveBeenCalledWith('front');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('flips to the next camera with one button on a touch screen', () => {
    setPointer(true);
    const onSwitchCamera = vi.fn();
    render(<ScannerCameraControls camera={camera()} cameras={cameras} onSwitchCamera={onSwitchCamera} onTorch={vi.fn()} onZoom={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
    expect(onSwitchCamera).toHaveBeenCalledWith('front');
  });

  it('toggles the torch and sets zoom when the camera supports them', async () => {
    const onTorch = vi.fn();
    const onZoom = vi.fn();
    const { container } = render(
      <ScannerCameraControls
        camera={camera({ torch: { supported: true, on: true }, zoom: { min: 1, max: 4, step: 0.5, value: 2 } })}
        cameras={[cameras[0]]}
        onSwitchCamera={vi.fn()}
        onTorch={onTorch}
        onZoom={onZoom}
      />
    );
    const torch = screen.getByRole('button', { name: 'Torch' });
    expect(torch).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(torch);
    expect(onTorch).toHaveBeenCalledWith(false);

    fireEvent.change(screen.getByRole('slider', { name: /zoom/i }), { target: { value: '3' } });
    expect(onZoom).toHaveBeenCalledWith(3);
    expect(await axe(container)).toHaveNoViolations();
  });
});
