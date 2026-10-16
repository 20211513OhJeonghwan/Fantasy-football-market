"use client";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption = { value: string; label: string; group?: string; icon?: ReactNode; hint?: string; disabled?: boolean; /** Extra search terms (e.g. English name). */ keywords?: string };
type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name when no visible <label htmlFor> points at `id`. */
  label?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onBlur?: () => void;
  /** Show a filter box. Defaults to on for long lists. */
  searchable?: boolean;
  variant?: "field" | "bare" | "compact";
  className?: string;
  /** Text shown on the trigger instead of the option label (e.g. a prefix). */
  display?: (option: SelectOption | undefined) => ReactNode;
};
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Accessible custom listbox replacing the native <select> (keyboard, type-ahead, search, groups). */
export function Select({ value, onChange, options, label, id, placeholder = "선택", disabled, invalid, describedBy, onBlur, searchable, variant = "field", className = "", display }: Props) {
  const auto = useId().replace(/:/g, "");
  const triggerId = id ?? `select-${auto}`;
  const listId = `${triggerId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const withSearch = searchable ?? options.length > 12;
  const selected = options.find((o) => o.value === value);
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return q ? options.filter((o) => normalize(`${o.label} ${o.group ?? ""} ${o.hint ?? ""} ${o.keywords ?? ""}`).includes(q)) : options;
  }, [options, query]);

  function openList() {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    setUp(!!rect && window.innerHeight - rect.bottom < 300 && rect.top > window.innerHeight - rect.bottom);
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function close(focus = true) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  function choose(option: SelectOption | undefined) {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  }
  function move(delta: number) {
    if (!visible.length) return;
    let next = active;
    for (let i = 0; i < visible.length; i++) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next].disabled) break;
    }
    setActive(next);
  }
  useEffect(() => {
    if (!open) return;
    if (withSearch) search.current?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); onBlur?.(); } };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, withSearch, onBlur]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKey(event: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openList(); }
      return;
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); return;
      case "ArrowUp": event.preventDefault(); move(-1); return;
      case "Home": event.preventDefault(); setActive(0); return;
      case "End": event.preventDefault(); setActive(visible.length - 1); return;
      case "Enter": event.preventDefault(); choose(visible[active]); return;
      case "Escape": event.preventDefault(); close(); return;
      case "Tab": setOpen(false); return;
      case " ":
        if (!withSearch) { event.preventDefault(); choose(visible[active]); }
        return;
    }
    if (!withSearch && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + normalize(event.key), at: now };
      const found = visible.findIndex((o) => normalize(o.label).startsWith(typed.current.text));
      if (found >= 0) setActive(found);
    }
  }
  let lastGroup: string | undefined;
  return (
    <div ref={root} className={`kx-select ${variant} ${open ? "open" : ""} ${invalid ? "invalid" : ""} ${className}`}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={open && !withSearch && visible[active] ? `${listId}-${active}` : undefined}
        disabled={disabled}
        className="kx-select-trigger"
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
        onBlur={() => { if (!open) onBlur?.(); }}
      >
        {selected?.icon && <span className="kx-select-icon">{selected.icon}</span>}
        <span className={`kx-select-value ${selected ? "" : "placeholder"}`}>{display ? display(selected) : selected?.label ?? placeholder}</span>
        <ChevronDown size={17} className="kx-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className={`kx-select-pop ${up ? "up" : ""}`} style={{ "--rows": Math.min(visible.length, 8) } as CSSProperties}>
          {withSearch && (
            <label className="kx-select-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={search}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKey}
                placeholder="검색"
                aria-label={`${label ?? "옵션"} 검색`}
                aria-controls={listId}
                aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
              />
            </label>
          )}
          <ul ref={list} id={listId} role="listbox" aria-label={label} tabIndex={-1}>
            {visible.map((option, index) => {
              const header = option.group && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;
              return (
                <li key={`${option.value}-${index}`} role="presentation">
                  {header && <span className="kx-select-group" aria-hidden="true">{header}</span>}
                  <div
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    className={`kx-select-option ${index === active ? "active" : ""} ${option.value === value ? "selected" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    {option.icon && <span className="kx-select-icon">{option.icon}</span>}
                    <span className="kx-select-label">{option.label}{option.hint && <small>{option.hint}</small>}</span>
                    {option.value === value && <Check size={16} className="kx-select-check" aria-hidden="true" />}
                  </div>
                </li>
              );
            })}
            {!visible.length && <li className="kx-select-empty" role="presentation">일치하는 항목이 없습니다</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
