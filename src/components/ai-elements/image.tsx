import type { Experimental_GeneratedImage } from "ai";

import { cn } from "@/lib/utils";

export type ImageProps = Partial<Experimental_GeneratedImage> & {
  className?: string;
  alt?: string;
  src?: string;
};

export const Image = ({
  base64,
  uint8Array: _uint8Array,
  mediaType,
  src,
  ...props
}: ImageProps) => {
  const imageSrc = src ?? (base64 && mediaType ? `data:${mediaType};base64,${base64}` : undefined);
  if (!imageSrc) return null;
  return (
    <img
      {...props}
      alt={props.alt}
      className={cn(
        "h-auto max-w-full overflow-hidden rounded-md",
        props.className
      )}
      src={imageSrc}
    />
  );
};
