import { useEffect, useState } from 'react';
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function usePwa() {
  const [installEvent, setInstallEvent] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installed, setInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches,
  );
  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((r) => {
          if (r.waiting) setWaiting(r.waiting);
          r.addEventListener('updatefound', () => {
            const worker = r.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller)
                setWaiting(worker);
            });
          });
        })
        .catch(() => {
          /* App remains usable when browser policy disallows installation. */
        });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  async function install() {
    if (!installEvent) return false;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    return true;
  }
  function update() {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
      once: true,
    });
    waiting?.postMessage({ type: 'SKIP_WAITING' });
  }
  return { install, canInstall: Boolean(installEvent), installed, waiting, update };
}
