/* The JRock_Wise mark — a rock cracked open with a $ inside, on brand green.
   Same art as the app icon, as inline SVG so it stays crisp at any size.
   Callers control size + corner rounding (wrap with overflow-hidden). */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <radialGradient id="jrw-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FDE68A" />
          <stop offset="0.55" stopColor="#EAB308" />
          <stop offset="1" stopColor="#B45309" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" fill="#16A34A" />
      <ellipse cx="256" cy="262" rx="64" ry="120" fill="url(#jrw-glow)" />
      <path
        d="M212 110 L146 148 L100 232 L108 330 L172 398 L232 404 L206 344 L236 292 L204 238 L238 178 L212 110 Z"
        fill="#454E5C"
        stroke="#242B35"
        strokeWidth="11"
        strokeLinejoin="round"
      />
      <path
        d="M262 104 L346 130 L410 212 L404 322 L336 400 L282 406 L308 346 L278 292 L312 238 L276 176 L262 104 Z"
        fill="#4E5866"
        stroke="#242B35"
        strokeWidth="11"
        strokeLinejoin="round"
      />
      <path d="M212 110 L146 148 L164 190 L212 168 Z" fill="#5C6678" />
      <path d="M262 104 L346 130 L330 176 L276 160 Z" fill="#5A6474" />
      <text
        x="257"
        y="318"
        fontFamily="system-ui, Arial, sans-serif"
        fontWeight="700"
        fontSize="160"
        fill="#fff"
        textAnchor="middle"
      >
        $
      </text>
    </svg>
  );
}
