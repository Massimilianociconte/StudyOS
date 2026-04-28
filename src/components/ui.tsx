import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { Icon } from "./Icon";

export function Button({
  children,
  icon,
  variant = "ghost",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  variant?: "primary" | "ghost" | "soft" | "danger";
}) {
  const variants = {
    primary: "bg-[var(--accent)] text-[#10131d] shadow-lift hover:scale-[1.02]",
    ghost: "bg-transparent text-[var(--text)] hover:bg-[var(--surface)]",
    soft: "bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]",
    danger: "bg-red-500/14 text-red-100 hover:bg-red-500/22"
  };

  return (
    <button
      type="button"
      className={`motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-extrabold ${variants[variant]} ${className}`}
      {...props}
    >
      {icon ? <Icon name={icon} className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`motion-safe grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:scale-[1.03] hover:bg-[var(--surface)] ${className}`}
      {...props}
    >
      <Icon name={icon} className="h-4.5 w-4.5" />
    </button>
  );
}

export function Panel({
  children,
  className = "",
  accent
}: PropsWithChildren<{ className?: string; accent?: string }>) {
  return (
    <motion.section
      layout
      className={`soft-panel min-w-0 p-[var(--pad)] ${className}`}
      style={accent ? ({ "--panel-accent": accent } as React.CSSProperties) : undefined}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
    >
      {children}
    </motion.section>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="safe-text text-2xl font-black leading-tight md:text-4xl">{title}</h2>
        {subtitle ? <p className="safe-text mt-1 max-w-2xl text-sm font-medium text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  active,
  className = ""
}: PropsWithChildren<{ active?: boolean; className?: string }>) {
  return (
    <span
      className={`inline-flex min-h-8 max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border px-3 text-xs font-extrabold ${
        active
          ? "border-transparent bg-[var(--accent)] text-[#10131d]"
          : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-strong)]">
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  label,
  color = "var(--accent)"
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;

  return (
    <div className="relative grid aspect-square w-full max-w-[180px] place-items-center rounded-super bg-[var(--surface-soft)]">
      <svg viewBox="0 0 108 108" className="absolute inset-0 h-full w-full rotate-[-90deg]">
        <circle cx="54" cy="54" r={radius} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="10" />
        <motion.circle
          cx="54"
          cy="54"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      </svg>
      <div className="relative text-center">
        <div className="text-3xl font-black">{Math.round(value)}%</div>
        <div className="text-xs font-bold text-[var(--muted)]">{label}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  className = ""
}: PropsWithChildren<{ label: string; className?: string }>) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-bold text-[var(--text)] placeholder:text-[var(--faint)]";

export function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="quiet-panel grid place-items-center p-8 text-center">
      <Icon name={icon} className="mb-3 h-8 w-8 text-[var(--accent)]" />
      <h3 className="safe-text text-lg font-black">{title}</h3>
      <p className="safe-text mt-1 max-w-sm text-sm text-[var(--muted)]">{body}</p>
    </div>
  );
}
