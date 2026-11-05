export function CloudMark() {
  return (
    <svg viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <path d="M7.4 21.2a6.4 6.4 0 0 1-.8-12.75A9.05 9.05 0 0 1 23.9 7.1a5.8 5.8 0 0 1 .7 11.75H7.4Z" fill="white" fillOpacity=".18" stroke="white" strokeWidth="1.8" />
      <path d="m10.8 14.3 3.05 3.05 7.4-7.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// One wordmark everywhere the product names itself: sign-in, navigation, the mobile header and recovery screens.
export function Brand({ size = 'regular', inverse = false, tagline = 'Hospital Records' }: { size?: 'regular' | 'small'; inverse?: boolean; tagline?: string | null }) {
  return <div className={['brand', size === 'small' && 'brand-small', inverse && 'brand-inverse'].filter(Boolean).join(' ')}>
    <div className="brand-mark"><CloudMark /></div>
    <div className="brand-copy"><strong>Medicare</strong>{tagline && <span>{tagline}</span>}</div>
  </div>
}
