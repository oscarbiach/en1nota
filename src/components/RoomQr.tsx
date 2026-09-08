import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function RoomQr({ url, size = 260 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: size, color: { dark: '#0b0b12', light: '#ffffff' } })
      .then((s) => alive && setSrc(s))
      .catch(() => {});
    return () => { alive = false; };
  }, [url, size]);
  return src ? <div className="qr"><img src={src} alt="QR para unirse" /></div> : null;
}
