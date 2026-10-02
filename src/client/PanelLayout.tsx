import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

type Panel = 'navigation' | 'activity';
type Widths = Record<Panel, number>;
const storageKey = 'aib-panel-layout';
const minimum: Widths = { navigation: 180, activity: 230 };
const maximum: Widths = { navigation: 420, activity: 480 };
const separatorsWidth = 16;
const conversationMinimum = 400;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function defaults(width: number): Widths {
  return width >= 1650
    ? { navigation: 265, activity: 320 }
    : width <= 1180
      ? { navigation: 200, activity: 250 }
      : { navigation: 238, activity: 292 };
}

function readWidths(): Widths | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const saved = value as Record<string, unknown>;
    if (saved.version !== 1 || Object.keys(saved).length !== 3) return null;
    for (const panel of ['navigation', 'activity'] as const) {
      const width = saved[panel];
      if (
        typeof width !== 'number' ||
        !Number.isInteger(width) ||
        width < minimum[panel] ||
        width > maximum[panel]
      )
        return null;
    }
    return { navigation: saved.navigation as number, activity: saved.activity as number };
  } catch {
    return null;
  }
}

/** Fit the view without overwriting the user's wider-screen preference. */
function fit(widths: Widths, width: number): Widths {
  const available = Math.max(
    minimum.navigation + minimum.activity,
    width - conversationMinimum - separatorsWidth,
  );
  if (widths.navigation + widths.activity <= available) return widths;
  const flexible = available - minimum.navigation - minimum.activity;
  const requested = widths.navigation + widths.activity - minimum.navigation - minimum.activity;
  const navigation =
    minimum.navigation +
    Math.floor((flexible * (widths.navigation - minimum.navigation)) / requested);
  return { navigation, activity: available - navigation };
}

type Drag = {
  panel: Panel;
  pointerId: number;
  x: number;
  widths: Widths;
  original: Widths | null;
  element: HTMLDivElement;
};

export function usePanelLayout(enabled: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1001px)').matches);
  const [preferences, setPreferences] = useState<Widths | null>(readWidths);
  const currentPreferences = useRef(preferences);
  const [collapsed, setCollapsed] = useState({ navigation: false, activity: false });
  const [notice, setNotice] = useState('');
  const [resizing, setResizing] = useState(false);
  const drag = useRef<Drag | null>(null);
  const helpId = useId();
  const widths = fit(preferences ?? defaults(width), width);

  function apply(next: Widths | null) {
    currentPreferences.current = next;
    setPreferences(next);
  }
  function save(next: Widths | null) {
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...next }));
      else localStorage.removeItem(storageKey);
      setNotice('');
    } catch {
      setNotice('Panel widths apply to this view, but browser storage is unavailable.');
    }
  }
  function endDrag(cancel: boolean) {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    // Pointer release can precede delivery of the media-query change/React effect.
    // Check the live viewport before persisting an unfinished desktop gesture.
    if (cancel || !enabled || !window.matchMedia('(min-width: 1001px)').matches)
      apply(active.original);
    else save(currentPreferences.current);
    setResizing(false);
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
  }

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    const query = window.matchMedia('(min-width: 1001px)');
    const changed = () => {
      if (!query.matches) endDrag(true);
      setDesktop(query.matches);
    };
    query.addEventListener('change', changed);
    return () => {
      observer.disconnect();
      query.removeEventListener('change', changed);
    };
  }, []);
  useEffect(() => {
    // A viewport/Settings transition cancels an unfinished gesture, without saving it.
    if (!desktop || !enabled) endDrag(true);
  }, [desktop, enabled]);

  function limit(panel: Panel, otherWidths = widths) {
    const other = panel === 'navigation' ? 'activity' : 'navigation';
    return Math.max(
      minimum[panel],
      Math.min(maximum[panel], width - conversationMinimum - separatorsWidth - otherWidths[other]),
    );
  }
  function adjust(panel: Panel, value: number, otherWidths = widths) {
    const next = {
      ...otherWidths,
      [panel]: clamp(Math.round(value), minimum[panel], limit(panel, otherWidths)),
    };
    apply(next);
    return next;
  }
  function keyDown(panel: Panel, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      endDrag(true);
      return;
    }
    if (drag.current || !desktop || !enabled) return;
    const step = event.shiftKey ? 50 : 10;
    const direction = panel === 'navigation' ? 1 : -1;
    const value =
      event.key === 'ArrowLeft'
        ? widths[panel] - direction * step
        : event.key === 'ArrowRight'
          ? widths[panel] + direction * step
          : event.key === 'Home'
            ? minimum[panel]
            : event.key === 'End'
              ? limit(panel)
              : null;
    if (value === null) return;
    event.preventDefault();
    save(adjust(panel, value));
  }
  function pointerDown(panel: Panel, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || !desktop || !enabled) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      panel,
      pointerId: event.pointerId,
      x: event.clientX,
      widths,
      original: currentPreferences.current,
      element: event.currentTarget,
    };
    setResizing(true);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const direction = active.panel === 'navigation' ? 1 : -1;
    adjust(
      active.panel,
      active.widths[active.panel] + direction * (event.clientX - active.x),
      active.widths,
    );
  }

  return {
    root,
    desktop,
    collapsed,
    notice,
    resizing,
    helpId,
    style: {
      '--navigation-width': `${widths.navigation}px`,
      '--activity-width': `${widths.activity}px`,
    } as CSSProperties,
    toggle: (panel: Panel) => setCollapsed((value) => ({ ...value, [panel]: !value[panel] })),
    reset: () => {
      endDrag(true);
      apply(null);
      save(null);
      setCollapsed({ navigation: false, activity: false });
    },
    separator: (panel: Panel) => ({
      role: 'separator',
      tabIndex: 0,
      className: 'panel-separator',
      hidden: !desktop || !enabled,
      'aria-label':
        panel === 'navigation' ? 'Resize workspace navigation' : 'Resize participant panel',
      'aria-orientation': 'vertical' as const,
      'aria-controls': panel === 'navigation' ? 'workspace-navigation' : 'workspace-activity',
      'aria-describedby': helpId,
      'aria-valuemin': minimum[panel],
      'aria-valuemax': limit(panel),
      'aria-valuenow': widths[panel],
      'aria-valuetext': `${widths[panel]} pixels wide`,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => keyDown(panel, event),
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => pointerDown(panel, event),
      onPointerMove: pointerMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId === event.pointerId) endDrag(false);
      },
      onPointerCancel: () => endDrag(true),
      onLostPointerCapture: () => endDrag(true),
    }),
  };
}
