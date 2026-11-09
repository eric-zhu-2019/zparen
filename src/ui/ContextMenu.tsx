import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextMenuItem = { id: string; label: string; run: () => void };

/**
 * A menu at the pointer, with null items as separators. It closes on a click
 * elsewhere, Escape, scrolling or leaving the window. The arrow keys move
 * between items and Return chooses one, as in a macOS menu.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (ContextMenuItem | null)[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  // Kept inside the window: a menu near the right or bottom edge opens toward the pointer's other side.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setAt({ left: Math.max(4, x + width > innerWidth - 4 ? x - width : x), top: Math.max(4, y + height > innerHeight - 4 ? y - height : y) });
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    };
  }, [onClose]);

  const move = (dir: 1 | -1) => {
    const buttons = [...(box.current?.querySelectorAll("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + dir + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={box}
      className="context-menu"
      role="menu"
      style={at}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown") move(1);
        else if (e.key === "ArrowUp") move(-1);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, i) =>
        item ? (
          <button
            key={item.id}
            role="menuitem"
            data-id={item.id}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ) : (
          <hr key={`sep-${i}`} />
        ),
      )}
    </div>
  );
}
