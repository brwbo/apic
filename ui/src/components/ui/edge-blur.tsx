"use client";

interface EdgeBlurProps {
  position?: "top" | "bottom";
  height?: number;
  /** `absolute` pins it to the nearest positioned ancestor instead of the viewport. */
  anchor?: "fixed" | "absolute";
}

export function EdgeBlur({ position = "bottom", height = 75, anchor = "absolute" }: EdgeBlurProps) {
  const blurLayers = [1, 2, 3, 6, 12];
  const isTop = position === "top";

  return (
    <div
      className={`${anchor} inset-x-0 isolate z-40 pointer-events-none ${isTop ? "top-0" : "bottom-0"}`}
      style={{ height }}
      aria-hidden
    >
      {blurLayers.map((blur) => (
        <div
          key={blur}
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${blur}px)`,
            WebkitBackdropFilter: `blur(${blur}px)`,
            maskImage: `linear-gradient(to ${isTop ? "bottom" : "top"}, black, transparent)`,
            WebkitMaskImage: `linear-gradient(to ${isTop ? "bottom" : "top"}, black, transparent)`,
          }}
        />
      ))}
    </div>
  );
}

export function TopBlur({ height = 75 }: { height?: number }) { return <EdgeBlur position="top" height={height} /> }
export function BottomBlur({ height = 75 }: { height?: number }) { return <EdgeBlur position="bottom" height={height} /> }
export default EdgeBlur;
