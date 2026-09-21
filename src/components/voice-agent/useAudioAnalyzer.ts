/**
 * Audio Analyzer Hook
 *
 * Analyzes microphone input in real-time for audio-reactive visualizations.
 * Provides volume, frequency data, and activity detection.
 */
import { useState, useEffect, useRef } from 'react'

interface AudioData {
  volume: number // 0-1, normalized volume
  frequencies: number[] // Frequency bins (0-1 normalized)
  isActive: boolean // Whether audio is detected
}

const SMOOTHING = 0.8
const FFT_SIZE = 512
const VOLUME_THRESHOLD = 0.01

/**
 * Custom hook for real-time audio analysis
 */
export function useAudioAnalyzer(enabled: boolean = false): AudioData {
  const [audioData, setAudioData] = useState<AudioData>({
    volume: 0,
    frequencies: new Array(32).fill(0),
    isActive: false,
  })

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyzerRef = useRef<AnalyserNode | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      cleanup()
      return
    }

    let isMounted = true

    const initAudio = async () => {
      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        micStreamRef.current = stream

        // Create audio context and analyzer
        const audioContext = new (window.AudioContext ||
          (window as any).webkitAudioContext)()
        audioContextRef.current = audioContext

        const analyzer = audioContext.createAnalyser()
        analyzer.fftSize = FFT_SIZE
        analyzer.smoothingTimeConstant = SMOOTHING
        analyzerRef.current = analyzer

        // Connect microphone to analyzer
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyzer)

        // Start analysis loop
        analyze()
      } catch (error) {
        console.error('Failed to initialize audio:', error)
        // Set default silent state
        setAudioData({
          volume: 0,
          frequencies: new Array(32).fill(0),
          isActive: false,
        })
      }
    }

    const analyze = () => {
      if (!analyzerRef.current || !isMounted) return

      const analyzer = analyzerRef.current
      const bufferLength = analyzer.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      const tick = () => {
        if (!isMounted || !analyzer) return

        // Get frequency data
        analyzer.getByteFrequencyData(dataArray)

        // Calculate volume (RMS)
        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          const normalized = dataArray[i] / 255
          sum += normalized * normalized
        }
        const rms = Math.sqrt(sum / bufferLength)
        const volume = Math.min(rms * 2, 1) // Amplify and clamp

        // Downsample frequencies to 32 bins for visualization
        const frequencyBins = 32
        const binSize = Math.floor(bufferLength / frequencyBins)
        const frequencies: number[] = []

        for (let i = 0; i < frequencyBins; i++) {
          let binSum = 0
          for (let j = 0; j < binSize; j++) {
            const index = i * binSize + j
            if (index < bufferLength) {
              binSum += dataArray[index] / 255
            }
          }
          frequencies.push(binSum / binSize)
        }

        // Detect if audio is active
        const isActive = volume > VOLUME_THRESHOLD

        setAudioData({
          volume,
          frequencies,
          isActive,
        })

        animationFrameRef.current = requestAnimationFrame(tick)
      }

      tick()
    }

    initAudio()

    return () => {
      isMounted = false
      cleanup()
    }
  }, [enabled])

  const cleanup = () => {
    // Stop animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    // Stop microphone stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyzerRef.current = null

    // Reset to silent state
    setAudioData({
      volume: 0,
      frequencies: new Array(32).fill(0),
      isActive: false,
    })
  }

  return audioData
}

/**
 * Hook for simulated audio data (for testing without microphone)
 */
export function useSimulatedAudio(enabled: boolean = false): AudioData {
  const [audioData, setAudioData] = useState<AudioData>({
    volume: 0,
    frequencies: new Array(32).fill(0),
    isActive: false,
  })

  useEffect(() => {
    if (!enabled) return

    let animationFrame: number

    const simulate = () => {
      const time = Date.now() / 1000

      // Simulate volume with sine wave
      const volume = (Math.sin(time * 2) + 1) / 2

      // Simulate frequencies with varying patterns
      const frequencies = Array.from({ length: 32 }, (_, i) => {
        const freq = Math.sin(time * 3 + i * 0.2) * 0.5 + 0.5
        return freq * volume
      })

      setAudioData({
        volume,
        frequencies,
        isActive: volume > 0.3,
      })

      animationFrame = requestAnimationFrame(simulate)
    }

    simulate()

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [enabled])

  return audioData
}
