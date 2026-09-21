/**
 * ThinkingBlob Component
 * 
 * An animated geometric blob with frosted glass morphism effects.
 * Shows during search processing to indicate AI is thinking.
 */

import { cn } from '@/utils/cn'

interface ThinkingBlobProps {
  className?: string
  size?: number
}

export function ThinkingBlob({ className, size = 400 }: ThinkingBlobProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 400 300"
      width={size}
      height={size * 0.75}
      className={cn('shrink-0', className)}
    >
      <defs>
        {/* FROSTED GLASS MORPHISM BASE */}
        <linearGradient id="frostBase" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a1a2e" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#16213e" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#0f0f1a" stopOpacity="0.12" />
        </linearGradient>

        {/* BLUE CORE GLOW */}
        <radialGradient id="blueCore" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="10%" stopColor="#E0F4FF" />
          <stop offset="25%" stopColor="#60A5FA" />
          <stop offset="45%" stopColor="#3B82F6" />
          <stop offset="65%" stopColor="#1D4ED8" />
          <stop offset="85%" stopColor="#1E3A8A" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#1E3A8A" stopOpacity="0" />
        </radialGradient>

        {/* PURPLE CORE GLOW */}
        <radialGradient id="purpleCore" cx="35%" cy="25%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="10%" stopColor="#F3E8FF" />
          <stop offset="25%" stopColor="#C084FC" />
          <stop offset="45%" stopColor="#A855F7" />
          <stop offset="65%" stopColor="#7C3AED" />
          <stop offset="85%" stopColor="#5B21B6" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#4C1D95" stopOpacity="0" />
        </radialGradient>

        {/* MINT CORE GLOW */}
        <radialGradient id="mintCore" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="10%" stopColor="#D1FAE5" />
          <stop offset="25%" stopColor="#6EE7B7" />
          <stop offset="45%" stopColor="#34D399" />
          <stop offset="65%" stopColor="#10B981" />
          <stop offset="85%" stopColor="#047857" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#064E3B" stopOpacity="0" />
        </radialGradient>

        {/* FROSTED SURFACE GRADIENTS */}
        <linearGradient id="frostCoral" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#F0F0F0" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#E0E0E0" stopOpacity="0.25" />
        </linearGradient>

        <linearGradient id="frostBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.25" />
          <stop offset="50%" stopColor="#3B82F6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0.2" />
        </linearGradient>

        <linearGradient id="frostPurple" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#5B21B6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#4C1D95" stopOpacity="0.3" />
        </linearGradient>

        <linearGradient id="frostMint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A7F3D0" stopOpacity="0.25" />
          <stop offset="50%" stopColor="#34D399" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#10B981" stopOpacity="0.2" />
        </linearGradient>

        {/* EDGE GLOW GRADIENTS */}
        <linearGradient id="edgeCoral" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#E8E8E8" />
          <stop offset="100%" stopColor="#D0D0D0" />
        </linearGradient>

        <linearGradient id="edgeBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#93C5FD" />
          <stop offset="50%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>

        <linearGradient id="edgePurple" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9333EA" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>

        <linearGradient id="edgeMint" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="50%" stopColor="#6EE7B7" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>

        {/* AMBIENT GLOW */}
        <radialGradient id="ambientBlue" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#3B82F6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#1D4ED8" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="ambientPurple" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#C084FC" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#A855F7" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
        </radialGradient>

        <radialGradient id="ambientMint" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#34D399" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
        </radialGradient>

        {/* FILTERS */}
        <filter id="ultraFrost" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
          <feColorMatrix in="blur" type="saturate" values="1.2" result="saturated" />
          <feMerge>
            <feMergeNode in="saturated" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="megaGlow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="3" result="b1" />
          <feGaussianBlur stdDeviation="8" result="b2" />
          <feGaussianBlur stdDeviation="15" result="b3" />
          <feGaussianBlur stdDeviation="30" result="b4" />
          <feGaussianBlur stdDeviation="50" result="b5" />
          <feMerge>
            <feMergeNode in="b5" />
            <feMergeNode in="b4" />
            <feMergeNode in="b3" />
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="edgeGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="innerFrost" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
        </filter>

        {/* Boomerang motion paths */}
        <path id="boomPath1" d="M 0 0 C 40 -70 130 -50 140 0 C 130 50 40 70 0 0" />
        <path id="boomPath2" d="M 0 0 C -30 -60 -120 -30 -135 10 C -110 70 -35 60 0 0" />
        <path id="boomPath3" d="M 0 0 C 20 55 95 70 120 30 C 80 -10 35 -25 0 0" />
        <path id="boomPath4" d="M 0 0 C 70 -20 110 30 90 70 C 60 120 10 70 0 0" />
        <path id="boomPath5" d="M 0 0 C -65 10 -120 55 -90 90 C -40 135 15 85 0 0" />
      </defs>

      {/* TRANSPARENT BACKGROUND */}
      <rect width="400" height="300" fill="transparent" />

      {/* DEEP AMBIENT GLOW LAYER */}
      <g opacity="0.6">
        {/* Blue ambient */}
        <ellipse cx="140" cy="120" rx="120" ry="90" fill="url(#ambientBlue)">
          <animate attributeName="rx" values="110;130;110" dur="4s" repeatCount="indefinite" />
          <animate attributeName="ry" values="80;100;80" dur="4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.7;0.4" dur="4s" repeatCount="indefinite" />
        </ellipse>

        {/* Purple ambient */}
        <ellipse cx="260" cy="130" rx="110" ry="85" fill="url(#ambientPurple)">
          <animate attributeName="rx" values="100;120;100" dur="5s" repeatCount="indefinite" begin="0.5s" />
          <animate attributeName="ry" values="75;95;75" dur="5s" repeatCount="indefinite" begin="0.5s" />
          <animate attributeName="opacity" values="0.35;0.65;0.35" dur="5s" repeatCount="indefinite" begin="0.5s" />
        </ellipse>

        {/* Mint ambient */}
        <ellipse cx="200" cy="200" rx="100" ry="75" fill="url(#ambientMint)">
          <animate attributeName="rx" values="90;110;90" dur="4.5s" repeatCount="indefinite" begin="1s" />
          <animate attributeName="ry" values="65;85;65" dur="4.5s" repeatCount="indefinite" begin="1s" />
          <animate attributeName="opacity" values="0.3;0.6;0.3" dur="4.5s" repeatCount="indefinite" begin="1s" />
        </ellipse>
      </g>

      {/* GEOMETRIC FORMS - LAYER 1 (BACK) */}
      
      {/* Large rotating hexagon - Coral frosted */}
      <g filter="url(#softGlow)">
        <g transform="translate(200, 150)">
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="40s" repeatCount="indefinite" additive="sum" />
          <animateTransform attributeName="transform" type="translate" values="200,150" dur="40s" repeatCount="indefinite" additive="replace" />

          {/* Frosted fill */}
          <polygon points="0,-75 65,-37.5 65,37.5 0,75 -65,37.5 -65,-37.5" fill="url(#frostCoral)" opacity="0.5">
            <animate attributeName="opacity" values="0.4;0.6;0.4" dur="3s" repeatCount="indefinite" />
          </polygon>

          {/* Glowing edge */}
          <polygon points="0,-75 65,-37.5 65,37.5 0,75 -65,37.5 -65,-37.5" fill="none" stroke="url(#edgeCoral)" strokeWidth="1.5" opacity="0.7" filter="url(#edgeGlow)">
            <animate attributeName="stroke-width" values="1;2;1" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2s" repeatCount="indefinite" />
          </polygon>
        </g>
      </g>

      {/* Medium blob - Lava lamp amorphous */}
      <g filter="url(#megaGlow)">
        <g transform="translate(200, 150)">
          <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="35s" repeatCount="indefinite" additive="sum" />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="200,150; 214,146; 198,166; 206,158; 192,144; 200,150"
            dur="28s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1"
            additive="replace"
          />

          {/* Primary blob */}
          <path fill="#7C3AED" opacity="0.6" d="M -60 0 C -42 -58 42 -58 60 0 C 46 60 -46 60 -60 0 Z">
            <animate
              attributeName="d"
              dur="6s"
              repeatCount="indefinite"
              values="
                M -60 0 C -42 -58 42 -58 60 0 C 46 60 -46 60 -60 0 Z;
                M -55 -5 C -30 -50 38 -65 58 -8 C 52 62 -38 58 -60 5 Z;
                M -62 4 C -48 -48 30 -62 62 -6 C 44 68 -42 64 -62 4 Z;
                M -60 0 C -42 -58 42 -58 60 0 C 46 60 -46 60 -60 0 Z"
            />
            <animate attributeName="opacity" values="0.4;0.75;0.4" dur="4s" repeatCount="indefinite" begin="0.5s" />
          </path>
        </g>
      </g>

      {/* Boomerang geometrics */}
      <g filter="url(#edgeGlow)">
        <g transform="translate(200, 150)">
          {/* Particle 1: tiny diamond */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.9;0" keyTimes="0;0.35;1" dur="2.8s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" type="rotate" values="0;220;0" dur="2.8s" repeatCount="indefinite" />
            <polygon points="0,-6 5,0 0,6 -5,0" fill="none" stroke="#93C5FD" strokeWidth="1.2" />
            <animateMotion dur="2.8s" repeatCount="indefinite" rotate="0">
              <mpath href="#boomPath1" />
            </animateMotion>
          </g>

          {/* Particle 2: tiny triangle */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.85;0" keyTimes="0;0.35;1" dur="3.2s" repeatCount="indefinite" begin="0.4s" />
            <animateTransform attributeName="transform" type="rotate" values="0;-260;0" dur="3.2s" repeatCount="indefinite" begin="0.4s" />
            <polygon points="0,-7 6,5 -6,5" fill="none" stroke="#7C3AED" strokeWidth="1.2" />
            <animateMotion dur="3.2s" repeatCount="indefinite" rotate="0" begin="0.4s">
              <mpath href="#boomPath2" />
            </animateMotion>
          </g>

          {/* Particle 3: tiny hex */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.8;0" keyTimes="0;0.35;1" dur="3.6s" repeatCount="indefinite" begin="0.9s" />
            <animateTransform attributeName="transform" type="rotate" values="0;320;0" dur="3.6s" repeatCount="indefinite" begin="0.9s" />
            <polygon points="0,-6 5,-3 5,3 0,6 -5,3 -5,-3" fill="none" stroke="#6EE7B7" strokeWidth="1.1" />
            <animateMotion dur="3.6s" repeatCount="indefinite" rotate="0" begin="0.9s">
              <mpath href="#boomPath3" />
            </animateMotion>
          </g>

          {/* Particle 4: tiny square */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.85;0" keyTimes="0;0.35;1" dur="3s" repeatCount="indefinite" begin="1.1s" />
            <animateTransform attributeName="transform" type="rotate" values="0;280;0" dur="3s" repeatCount="indefinite" begin="1.1s" />
            <polygon points="-5,-5 5,-5 5,5 -5,5" fill="none" stroke="#60A5FA" strokeWidth="1.1" />
            <animateMotion dur="3s" repeatCount="indefinite" rotate="0" begin="1.1s">
              <mpath href="#boomPath1" />
            </animateMotion>
          </g>

          {/* Particle 5: tiny chevron */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.8;0" keyTimes="0;0.35;1" dur="3.4s" repeatCount="indefinite" begin="1.6s" />
            <animateTransform attributeName="transform" type="rotate" values="0;-340;0" dur="3.4s" repeatCount="indefinite" begin="1.6s" />
            <polygon points="-6,-2 0,-6 6,-2 2,2 0,0 -2,2" fill="none" stroke="#C084FC" strokeWidth="1.1" />
            <animateMotion dur="3.4s" repeatCount="indefinite" rotate="0" begin="1.6s">
              <mpath href="#boomPath2" />
            </animateMotion>
          </g>

          {/* Particle 6: tiny diamond (2nd) */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.75;0" keyTimes="0;0.35;1" dur="4s" repeatCount="indefinite" begin="0.2s" />
            <animateTransform attributeName="transform" type="rotate" values="0;360;0" dur="4s" repeatCount="indefinite" begin="0.2s" />
            <polygon points="0,-5 4,0 0,5 -4,0" fill="none" stroke="#E8E8E8" strokeWidth="1" />
            <animateMotion dur="4s" repeatCount="indefinite" rotate="0" begin="0.2s">
              <mpath href="#boomPath4" />
            </animateMotion>
          </g>

          {/* Particle 7: tiny triangle (2nd) */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.75;0" keyTimes="0;0.35;1" dur="4.2s" repeatCount="indefinite" begin="0.9s" />
            <animateTransform attributeName="transform" type="rotate" values="0;300;0" dur="4.2s" repeatCount="indefinite" begin="0.9s" />
            <polygon points="0,-6 5,4 -5,4" fill="none" stroke="#93C5FD" strokeWidth="1" />
            <animateMotion dur="4.2s" repeatCount="indefinite" rotate="0" begin="0.9s">
              <mpath href="#boomPath5" />
            </animateMotion>
          </g>

          {/* Particle 8: tiny hex (2nd) */}
          <g opacity="0">
            <animate attributeName="opacity" values="0;0.7;0" keyTimes="0;0.35;1" dur="4.6s" repeatCount="indefinite" begin="1.3s" />
            <animateTransform attributeName="transform" type="rotate" values="0;-260;0" dur="4.6s" repeatCount="indefinite" begin="1.3s" />
            <polygon points="0,-5 4,-2.5 4,2.5 0,5 -4,2.5 -4,-2.5" fill="none" stroke="#6EE7B7" strokeWidth="1" />
            <animateMotion dur="4.6s" repeatCount="indefinite" rotate="0" begin="1.3s">
              <mpath href="#boomPath3" />
            </animateMotion>
          </g>
        </g>
      </g>

      {/* Small blob - Lava lamp amorphous */}
      <g filter="url(#megaGlow)">
        <g transform="translate(200, 150)">
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="25s" repeatCount="indefinite" additive="sum" />
          <animateTransform attributeName="transform" type="translate" values="200,150" dur="25s" repeatCount="indefinite" additive="replace" />

          {/* Primary blob */}
          <path fill="#3B82F6" opacity="0.6" d="M -35 0 C -20 -40 22 -38 36 0 C 22 38 -22 40 -35 0 Z">
            <animate
              attributeName="d"
              dur="5s"
              repeatCount="indefinite"
              values="
                M -35 0 C -20 -40 22 -38 36 0 C 22 38 -22 40 -35 0 Z;
                M -32 -2 C -15 -32 18 -45 34 -4 C 24 44 -18 36 -36 2 Z;
                M -36 3 C -22 -28 12 -42 38 -2 C 26 42 -20 46 -34 0 Z;
                M -35 0 C -20 -40 22 -38 36 0 C 22 38 -22 40 -35 0 Z"
            />
            <animate attributeName="opacity" values="0.4;0.75;0.4" dur="3.5s" repeatCount="indefinite" begin="1s" />
          </path>
        </g>
      </g>

      {/* Royal blue hexagon beneath white */}
      <g filter="url(#softGlow)">
        <g transform="translate(200, 150)">
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="34s" repeatCount="indefinite" additive="sum" />
          <animateTransform attributeName="transform" type="translate" values="200,150" dur="34s" repeatCount="indefinite" additive="replace" />

          {/* Frosted fill */}
          <polygon points="0,-75 65,-37.5 65,37.5 0,75 -65,37.5 -65,-37.5" fill="url(#frostBlue)" opacity="0.55">
            <animate attributeName="opacity" values="0.45;0.75;0.45" dur="3s" repeatCount="indefinite" begin="0.8s" />
          </polygon>

          {/* Glowing edge */}
          <polygon points="0,-75 65,-37.5 65,37.5 0,75 -65,37.5 -65,-37.5" fill="none" stroke="url(#edgeBlue)" strokeWidth="1.6" opacity="0.75" filter="url(#edgeGlow)">
            <animate attributeName="stroke-width" values="1.2;2.2;1.2" dur="2.2s" repeatCount="indefinite" begin="0.4s" />
            <animate attributeName="opacity" values="0.55;0.95;0.55" dur="2.2s" repeatCount="indefinite" begin="0.4s" />
          </polygon>
        </g>
      </g>

      {/* Second hexagon on top - counter-rotating */}
      <g filter="url(#edgeGlow)">
        <g transform="translate(200, 150)">
          <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="40s" repeatCount="indefinite" additive="sum" />
          <animateTransform attributeName="transform" type="translate" values="200,150" dur="40s" repeatCount="indefinite" additive="replace" />

          {/* Frosted fill */}
          <polygon points="0,-75 65,-37.5 65,37.5 0,75 -65,37.5 -65,-37.5" fill="url(#frostCoral)" opacity="0.65">
            <animate attributeName="opacity" values="0.55;0.85;0.55" dur="3s" repeatCount="indefinite" begin="1.5s" />
          </polygon>

          {/* Glowing edge */}
          <polygon points="0,-75 65,-37.5 65,37.5 0,75 -65,37.5 -65,-37.5" fill="none" stroke="url(#edgeCoral)" strokeWidth="1.5" opacity="0.7" filter="url(#edgeGlow)">
            <animate attributeName="stroke-width" values="1;2;1" dur="2s" repeatCount="indefinite" begin="1s" />
            <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2s" repeatCount="indefinite" begin="1s" />
          </polygon>
        </g>
      </g>
    </svg>
  )
}

export default ThinkingBlob
