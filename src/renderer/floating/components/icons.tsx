import type { ReactNode, SVGProps } from 'react'

function Icon({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ExplainIcon = () => (
  <Icon><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z" /></Icon>
)
export const DebugIcon = () => (
  <Icon><rect x="7" y="8" width="10" height="12" rx="5" /><path d="M12 8v12M9 5.5 10.5 8M15 5.5 13.5 8M3.5 13H7M17 13h3.5M4.5 8.5 7.4 10M19.5 8.5 16.6 10M4.5 18.5l2.9-1.6M19.5 18.5l-2.9-1.6" /></Icon>
)
export const RewriteIcon = () => (
  <Icon><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Icon>
)
export const SummarizeIcon = () => (
  <Icon><path d="M4 6h16M4 11h12M4 16h7" /><path d="m16 16 2 2 3.5-4" /></Icon>
)
export const ReplyIcon = () => (
  <Icon><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20" /></Icon>
)
export const ImproveIcon = () => (
  <Icon><path d="m4 20 11-11M13 7l4 4" /><path d="M18 3v3M16.5 4.5h3M20 9.5v2M19 10.5h2M9 3.5v2M8 4.5h2" /></Icon>
)
export const AskIcon = () => (
  <Icon><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-3.9A8 8 0 1 1 20 12Z" /><path d="M9 11.5h.01M12 11.5h.01M15 11.5h.01" strokeWidth={2.4} /></Icon>
)
export const TargetIcon = () => (
  <Icon><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></Icon>
)
export const GlobeIcon = () => (
  <Icon size={13}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>
)
export const MoreIcon = () => (
  <Icon><path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={2.8} /></Icon>
)
export const ScanIcon = () => (
  <Icon><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 10h8M8 14h5" /></Icon>
)
export const ScreenIcon = () => (
  <Icon><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon>
)
export const PageIcon = () => (
  <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Icon>
)
export const CopyIcon = () => (
  <Icon size={15}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>
)
export const CheckIcon = () => (
  <Icon size={15}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
)
export const RetryIcon = () => (
  <Icon size={15}><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" /><path d="M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5" /><path d="M4 20v-4.5h4.5" /></Icon>
)
export const InsertIcon = () => (
  <Icon size={15}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 20h14" /></Icon>
)
export const SendIcon = () => (
  <Icon size={16} strokeWidth={2}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>
)
export const MicIcon = () => (
  <Icon size={16} strokeWidth={2}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" /></Icon>
)
export const StopIcon = () => (
  <Icon size={14}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></Icon>
)
export const GearIcon = () => (
  <Icon size={15}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Icon>
)

/** SmartCursor mark: a pointer on a gradient tile. The gradient turns while a request runs. */
export function Logo({ busy }: { busy?: boolean }) {
  return (
    <span className={`sc-logo ${busy ? 'sc-logo-busy' : ''}`} aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 24 24">
        <path d="M5 3.5 19 11l-6.2 1.8L9.6 19 5 3.5Z" fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
