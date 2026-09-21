/**
 * Voice Agent Visualizer - Three.js audio-reactive visualization
 *
 * Features:
 * - Glassmorphic central orb that pulses with voice
 * - Audio-reactive particle field
 * - Energy rings that respond to frequency
 * - Royal blue color scheme matching Ron Browser aesthetic
 */
import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { useAudioAnalyzer } from './useAudioAnalyzer'

interface VoiceOrbProps {
  audioData: {
    volume: number
    frequencies: number[]
    isActive: boolean
  }
}

/**
 * Central glassmorphic orb that responds to voice
 */
function VoiceOrb({ audioData }: VoiceOrbProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  // Custom glassmorphic shader
  const shader = useMemo(
    () => ({
      uniforms: {
        time: { value: 0 },
        volume: { value: 0 },
        color: { value: new THREE.Color('#2D3B87') }, // Royal blue
        opacity: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        uniform float time;
        uniform float volume;

        // Noise function for organic movement
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

        float snoise(vec3 v) {
          const vec2 C = vec2(1.0/6.0, 1.0/3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i  = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ *ns.x + ns.yyyy;
          vec4 y = y_ *ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
          vec3 p0 = vec3(a0.xy, h.x);
          vec3 p1 = vec3(a0.zw, h.y);
          vec3 p2 = vec3(a1.xy, h.z);
          vec3 p3 = vec3(a1.zw, h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
          p0 *= norm.x;
          p1 *= norm.y;
          p2 *= norm.z;
          p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;

          // Add audio-reactive displacement
          float noise = snoise(position * 0.5 + time * 0.3);
          float displacement = noise * volume * 0.3;

          vec3 newPosition = position + normal * displacement;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        uniform float time;
        uniform float volume;
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          // Fresnel effect for glassmorphic look
          vec3 viewDirection = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDirection, vNormal)), 3.0);

          // Pulsing glow based on audio
          float glow = 0.5 + volume * 0.5;

          // Iridescent effect
          float iridescence = sin(vPosition.x * 2.0 + time) * 0.5 + 0.5;
          vec3 finalColor = mix(color, vec3(1.0), iridescence * 0.2);

          // Combine effects
          finalColor = mix(finalColor, vec3(1.0), fresnel * 0.3);
          float finalOpacity = opacity + fresnel * 0.3 + volume * 0.2;

          gl_FragColor = vec4(finalColor * glow, finalOpacity);
        }
      `,
    }),
    []
  )

  // Animate based on audio
  useFrame((state) => {
    if (meshRef.current && materialRef.current) {
      const time = state.clock.getElapsedTime()
      materialRef.current.uniforms.time.value = time
      materialRef.current.uniforms.volume.value = audioData.volume

      // Scale pulsing based on volume
      const scale = 1 + audioData.volume * 0.3
      meshRef.current.scale.set(scale, scale, scale)

      // Gentle rotation
      meshRef.current.rotation.y = time * 0.1
    }
  })

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[2, 4]} />
      <shaderMaterial
        ref={materialRef}
        args={[shader]}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/**
 * Audio-reactive particle field
 */
function ParticleField({ audioData }: VoiceOrbProps) {
  const particlesRef = useRef<THREE.Points>(null)
  const particleCount = 2000

  const { basePositions, colors } = useMemo(() => {
    const basePositions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const royalBlue = new THREE.Color('#2D3B87')

    for (let i = 0; i < particleCount; i++) {
      // Spherical distribution
      const radius = 5 + Math.random() * 5
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 2 - 1)

      basePositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      basePositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      basePositions[i * 3 + 2] = radius * Math.cos(phi)

      // Color variation
      const colorVariation = new THREE.Color().lerpColors(
        royalBlue,
        new THREE.Color('#FFFFFF'),
        Math.random() * 0.5
      )
      colors[i * 3] = colorVariation.r
      colors[i * 3 + 1] = colorVariation.g
      colors[i * 3 + 2] = colorVariation.b
    }

    return { basePositions, colors }
  }, [])

  useFrame((state) => {
    const particles = particlesRef.current
    if (!particles) return

    const geometry = particles.geometry
    const time = state.clock.getElapsedTime()
    const positionAttr = geometry.attributes.position
    const target = positionAttr.array as Float32Array

    // Animate particles based on audio
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3
      const x = basePositions[i3]
      const y = basePositions[i3 + 1]
      const z = basePositions[i3 + 2]

      // Get frequency for this particle
      const freqIndex = Math.floor((i / particleCount) * audioData.frequencies.length)
      const freq = audioData.frequencies[freqIndex] || 0

      // Orbital motion with audio influence
      const radius = Math.sqrt(x * x + y * y + z * z)
      const theta = Math.atan2(y, x) + time * 0.1 + freq * 0.01
      const phi = Math.acos(z / radius) + Math.sin(time * 0.5 + i * 0.01) * 0.1

      const newRadius = radius + audioData.volume * Math.sin(i + time) * 0.5

      target[i3] = newRadius * Math.sin(phi) * Math.cos(theta)
      target[i3 + 1] = newRadius * Math.sin(phi) * Math.sin(theta)
      target[i3 + 2] = newRadius * Math.cos(phi)
    }

    positionAttr.needsUpdate = true
    particles.rotation.y = time * 0.05
  })

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          args={[basePositions, 3]}
          attach="attributes-position"
          count={particleCount}
        />
        <bufferAttribute
          args={[colors, 3]}
          attach="attributes-color"
          count={particleCount}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        vertexColors
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}

/**
 * Energy rings that pulse with audio
 */
function EnergyRings({ audioData }: VoiceOrbProps) {
  const ringsRef = useRef<THREE.Group>(null)
  const ringCount = 5

  useFrame((state) => {
    if (ringsRef.current) {
      const time = state.clock.getElapsedTime()

      ringsRef.current.children.forEach((ring: THREE.Object3D, i: number) => {
        // Rotate each ring differently
        ring.rotation.x = time * 0.2 * (i % 2 === 0 ? 1 : -1)
        ring.rotation.z = time * 0.15 * (i % 2 === 0 ? -1 : 1)

        // Scale based on audio and ring index
        const freqIndex = Math.floor((i / ringCount) * audioData.frequencies.length)
        const freq = audioData.frequencies[freqIndex] || 0
        const scale = 1 + (audioData.volume + freq) * 0.2
        ring.scale.set(scale, scale, scale)

        // Opacity pulse
        const material = (ring as THREE.Mesh).material as THREE.MeshBasicMaterial
        material.opacity = 0.1 + audioData.volume * 0.3 + Math.sin(time * 2 + i) * 0.1
      })
    }
  })

  return (
    <group ref={ringsRef}>
      {Array.from({ length: ringCount }).map((_, i) => {
        const radius = 3 + i * 0.8
        return (
          <mesh key={i} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, 0.02, 16, 100]} />
            <meshBasicMaterial
              color="#2D3B87"
              transparent
              opacity={0.2}
              side={THREE.DoubleSide}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * Main Three.js scene
 */
function Scene({ audioData }: VoiceOrbProps) {
  return (
    <>
      <color attach="background" args={['#0A0A0A']} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} color="#2D3B87" />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#FFFFFF" />

      <VoiceOrb audioData={audioData} />
      <ParticleField audioData={audioData} />
      <EnergyRings audioData={audioData} />

      <Environment preset="night" />
    </>
  )
}

/**
 * Main component - Voice Agent Visualizer
 */
interface VoiceAgentVisualizerProps {
  isListening?: boolean
  className?: string
}

export function VoiceAgentVisualizer({
  isListening = false,
  className = '',
}: VoiceAgentVisualizerProps) {
  const audioData = useAudioAnalyzer(isListening)

  return (
    <div className={`relative w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 10], fov: 75 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene audioData={audioData} />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.5}
        />
      </Canvas>

      {/* Status overlay */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="glass-frosted px-6 py-3 rounded-full">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full transition-all duration-300 ${
                isListening
                  ? 'bg-royal animate-pulse shadow-lg shadow-royal/50'
                  : 'bg-ron-smoke'
              }`}
            />
            <span className="text-sm font-raleway font-light text-ron-white">
              {isListening ? 'Listening...' : 'Ready'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
