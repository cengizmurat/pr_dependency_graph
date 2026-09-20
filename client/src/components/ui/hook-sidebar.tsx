// Adapted from Rare UI's Hook Sidebar (https://github.com/swamimalode07/rare-ui),
// MIT License, Copyright (c) 2026 Swami Malode. Next.js routing is replaced
// with react-router; an item can carry a badge and a tooltip, and a caller can
// render a block under any row, so a list can open detail beneath its hook.
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const CORNER = 6;
const DASH =
  "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";

export type HookSidebarItem =
  | string
  | { label: string; href?: string; title?: string; badge?: string };

export type HookSidebarProps = Omit<ComponentProps<"nav">, "onChange"> & {
  items: HookSidebarItem[];
  label?: string;
  value?: number;
  defaultValue?: number;
  onChange?: (index: number) => void;
  color?: string;
  dashed?: boolean;
  // rendered inside the list, straight under the row it is given for
  renderBelow?: (index: number) => ReactNode;
};

const hrefOf = (item: HookSidebarItem) =>
  typeof item === "string" ? undefined : item.href;

const labelOf = (item: HookSidebarItem) =>
  typeof item === "string" ? item : item.label;

const titleOf = (item: HookSidebarItem) =>
  typeof item === "string" ? undefined : item.title;

const badgeOf = (item: HookSidebarItem) =>
  typeof item === "string" ? undefined : item.badge;

const Rail = ({
  from = 0,
  y,
  visible,
  color,
  dashed,
  className,
}: {
  from?: number;
  y: number | null;
  visible: boolean;
  color?: string;
  dashed: boolean;
  className?: string;
}) => {
  const reduced = useReducedMotion();
  const travel = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <motion.span
      aria-hidden
      initial={false}
      style={{ color }}
      animate={{ opacity: visible && y !== null ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2 }}
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <motion.span
        initial={false}
        animate={{ top: from, height: Math.max(0, (y ?? 0) - CORNER - from) }}
        transition={travel}
        style={
          dashed
            ? { backgroundImage: DASH }
            : { backgroundColor: "currentColor" }
        }
        className="absolute left-0.5 w-px"
      />
      <motion.svg
        initial={false}
        animate={{ top: (y ?? 0) - CORNER }}
        transition={travel}
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        className="absolute left-0.5"
      >
        <path
          d="M0.5 0a6 6 0 0 0 6 6H12"
          stroke="currentColor"
          strokeDasharray={dashed ? "2 2" : undefined}
        />
      </motion.svg>
    </motion.span>
  );
};

export function HookSidebar({
  items,
  label,
  value,
  defaultValue = 0,
  onChange,
  color = "#FC4C01",
  dashed = true,
  renderBelow,
  className,
  ...props
}: HookSidebarProps) {
  const { pathname } = useLocation();
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [centers, setCenters] = useState<number[]>([]);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const routed = items.some((item) => hrefOf(item));
  const routeIndex = items.findIndex((item) => hrefOf(item) === pathname);
  const activeIndex = value ?? (routed ? routeIndex : internalValue);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () =>
      setCenters(
        itemRefs.current
          .slice(0, items.length)
          .map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0)),
      );

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items.length]);

  const activeY = activeIndex < 0 ? null : (centers[activeIndex] ?? null);
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null);

  // above the active row the accent line already covers the span, so draw only the corner
  const hoverFrom =
    activeY !== null && hoverY !== null && hoverY <= activeY
      ? Math.max(0, hoverY - CORNER)
      : (activeY ?? 0);

  const select = (index: number) => {
    if (value === undefined) setInternalValue(index);
    onChange?.(index);
  };

  return (
    <nav
      data-slot="hook-sidebar"
      aria-label={label}
      className={cn("flex flex-col", className)}
      {...props}
    >
      {label && (
        <span
          data-slot="hook-sidebar-label"
          className="pb-2 pl-1 pr-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
        >
          {label}
        </span>
      )}

      <div
        ref={listRef}
        onMouseLeave={() => setPointerInside(false)}
        className="relative flex flex-col gap-0.5"
      >
        <Rail
          from={hoverFrom}
          y={hoverY}
          visible={(pointerInside || focusInside) && hoverIndex !== activeIndex}
          dashed={dashed}
          className="text-foreground/30"
        />
        <Rail
          y={activeY}
          visible={activeY !== null}
          color={color}
          dashed={dashed}
        />

        {items.map((item, index) => {
          const text = labelOf(item);
          const href = hrefOf(item);
          const badge = badgeOf(item);
          const isActive = index === activeIndex;
          const setRef = (el: HTMLElement | null) => {
            itemRefs.current[index] = el;
          };
          const rowProps = {
            "data-slot": "hook-sidebar-item",
            "data-active": isActive,
            title: titleOf(item),
            onMouseEnter: () => {
              setHoverIndex(index);
              setPointerInside(true);
            },
            onFocus: () => {
              setHoverIndex(index);
              setFocusInside(true);
            },
            onBlur: () => setFocusInside(false),
            onClick: () => select(index),
            className: cn(
              "flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 pl-5 pr-2 text-left text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              isActive
                ? "text-foreground"
                : "text-foreground/50 hover:text-foreground/80",
            ),
          };
          const content = (
            <>
              <span className="min-w-0 flex-1 truncate">{text}</span>
              {badge && (
                <span
                  data-slot="hook-sidebar-badge"
                  className="shrink-0 rounded-full border border-line px-1.5 text-[10px] font-medium leading-4 text-muted-foreground"
                >
                  {badge}
                </span>
              )}
            </>
          );

          return href ? (
            <Link
              key={`${index}-${text}`}
              {...rowProps}
              ref={setRef}
              to={href}
              aria-current={isActive ? "page" : undefined}
            >
              {content}
            </Link>
          ) : (
            <button
              key={`${index}-${text}`}
              {...rowProps}
              ref={setRef}
              type="button"
              aria-current={isActive ? "true" : undefined}
            >
              {content}
            </button>
          );
        }).flatMap((row, index) => {
          const below = renderBelow?.(index);
          return below ? [row, <div key={`below-${index}`}>{below}</div>] : [row];
        })}
      </div>
    </nav>
  );
}

export default HookSidebar;
