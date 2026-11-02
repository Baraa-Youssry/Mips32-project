import { useEffect, useRef, useState } from 'react';

export type MenuBarProps = {
  running: boolean;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onAssemble(): void;
  onReinitialize(): void;
  onRun(): void;
  onPause(): void;
  onStep(): void;
  onStop(): void;
  dark: boolean;
  onToggleTheme(): void;
  onHelp(): void;
};

type MenuItem = { label: string; shortcut?: string; onSelect(): void; disabled?: boolean };
type MenuDef = { name: string; items: (MenuItem | 'sep')[] };

export default function MenuBar(p: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const menus: MenuDef[] = [
    {
      name: 'File',
      items: [
        { label: 'New program', onSelect: p.onNew },
        { label: 'Open .s / .asm…', shortcut: 'Ctrl+O', onSelect: p.onOpen },
        { label: 'Save as…', shortcut: 'Ctrl+S', onSelect: p.onSave },
      ],
    },
    {
      name: 'Simulator',
      items: [
        { label: 'Assemble', shortcut: 'F6', onSelect: p.onAssemble, disabled: p.running },
        { label: 'Reinitialize', onSelect: p.onReinitialize, disabled: p.running },
        'sep',
        { label: 'Run / Resume', shortcut: 'F5', onSelect: p.onRun, disabled: p.running },
        { label: 'Pause', onSelect: p.onPause, disabled: !p.running },
        { label: 'Step', shortcut: 'F10', onSelect: p.onStep, disabled: p.running },
        { label: 'Stop', onSelect: p.onStop, disabled: !p.running },
      ],
    },
    {
      name: 'Settings',
      items: [{ label: p.dark ? 'Switch to light theme' : 'Switch to dark theme', onSelect: p.onToggleTheme }],
    },
    { name: 'Help', items: [{ label: 'About & shortcuts', onSelect: p.onHelp }] },
  ];

  return (
    <div className="menubar" ref={ref}>
      {menus.map((m) => (
        <div key={m.name} className={open === m.name ? 'menu open' : 'menu'}>
          <button
            onClick={() => setOpen(open === m.name ? null : m.name)}
            aria-haspopup="menu"
            aria-expanded={open === m.name}
          >
            {m.name}
          </button>
          {open === m.name && (
            <div className="dropdown" role="menu">
              {m.items.map((it, i) =>
                it === 'sep' ? (
                  <div className="sep" key={i} />
                ) : (
                  <button
                    key={i}
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.onSelect();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span className="kbd">{it.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
