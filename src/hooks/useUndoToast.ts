import { useCallback } from 'react';
import { useOptionalQRStore } from '@/context/QRContext';
import { useToast } from '@/components/ui/Toast';

/**
 * Returns a function that tells the person a bigger appearance change happened and offers
 * Undo, which steps the generator's in-memory history back. Outside a generator it does nothing.
 * @returns Call it with the sentence to show, after making the change.
 */
export function useUndoToast(): (message: string) => void {
  const store = useOptionalQRStore();
  const { addToast } = useToast();
  return useCallback(
    (message: string) => {
      if (!store) return;
      addToast({
        type: 'info',
        message,
        persistent: true,
        action: { label: 'Undo', onClick: () => void store.undo() },
      });
    },
    [store, addToast]
  );
}
