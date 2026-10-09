import { useMemo, useState } from "react";
import { gatewayUrls } from "../lib/metadata";

interface Props {
  name: string;
  imageUri?: string | null;
  size?: number;
}

/** Image with gateway fallback chain; falls back to a monogram on total failure. */
export function TokenAvatar({ name, imageUri, size = 34 }: Props) {
  const urls = useMemo(() => (imageUri ? gatewayUrls(imageUri) : []), [imageUri]);
  const [idx, setIdx] = useState(0);
  const letters = useMemo(() => {
    const clean = name.replace(/[^a-zA-Z0-9 ]/g, "").trim();
    if (!clean) return "?";
    const parts = clean.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
  }, [name]);

  if (urls.length === 0 || idx >= urls.length) {
    return (
      <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
        {letters}
      </span>
    );
  }
  return (
    <img
      className="avatar"
      style={{ width: size, height: size }}
      src={urls[idx]}
      alt=""
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
