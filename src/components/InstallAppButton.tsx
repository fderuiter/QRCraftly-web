import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui/Button';

/** The `beforeinstallprompt` event, which only Chromium browsers fire. It is not in the DOM types. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Offers to install QRCraftly as an app where the browser allows it. The button appears only
 * after the browser fires `beforeinstallprompt`, so it never shows where installing is
 * impossible or already done. Nothing about the choice is stored or sent anywhere.
 * @returns The install button, or null while the browser offers no install.
 */
export function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!promptEvent) return null;

  const install = async () => {
    await promptEvent.prompt();
    await promptEvent.userChoice;
    // A prompt event can be used only once.
    setPromptEvent(null);
  };

  return (
    <Button variant="outline" size="sm" className="mt-4" onClick={install}>
      <Download className="size-4" aria-hidden="true" />
      Install QRCraftly
    </Button>
  );
}
