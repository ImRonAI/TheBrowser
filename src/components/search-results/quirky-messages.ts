/**
 * Quirky Loading Messages
 * 
 * A delightful collection of whimsical loading messages
 * that rotate randomly during any loading state.
 */

// The ultimate collection of quirky loading messages
export const QUIRKY_MESSAGES = [
  // Animal & creature themed
  "Herding digital cats...",
  "Teaching pixels to purr...",
  "Convincing electrons to cooperate...",
  "Befriending helpful algorithms...",
  "Tickling the neural networks...",
  "Waking up the data hamsters...",
  "Feeding the search gremlins...",
  "Walking the binary dogs...",
  "Petting quantum kittens...",
  "Negotiating with code monkeys...",
  
  // Magic & mystical
  "Consulting the digital oracle...",
  "Brewing some search magic...",
  "Polishing search crystals...",
  "Summoning relevant results...",
  "Casting a knowledge spell...",
  "Reading the silicon tea leaves...",
  "Channeling the WiFi spirits...",
  "Invoking the cloud gods...",
  "Performing data alchemy...",
  "Awakening ancient algorithms...",
  
  // Science & tech
  "Charging my curiosity beam...",
  "Calibrating the wonder engine...",
  "Spinning up the flux capacitor...",
  "Warming up the neurons...",
  "Defragmenting thoughts...",
  "Compiling curiosity...",
  "Initializing wonder mode...",
  "Rebooting my enthusiasm...",
  "Syncing with the mothership...",
  "Quantum entangling your request...",
  
  // Food & drinks
  "Brewing a fresh pot of insights...",
  "Marinating the data...",
  "Letting the results simmer...",
  "Adding a pinch of AI magic...",
  "Baking knowledge cookies...",
  "Stirring the information soup...",
  "Toasting the search bread...",
  "Sipping wisdom tea...",
  "Sprinkling pixel dust...",
  "Fermenting fresh ideas...",
  
  // Adventure & exploration
  "Exploring the digital wilderness...",
  "Mapping the knowledge galaxy...",
  "Diving into the data ocean...",
  "Climbing the information mountain...",
  "Navigating the neural forest...",
  "Surfing the data waves...",
  "Mining for golden insights...",
  "Treasure hunting in databases...",
  "Charting unknown territories...",
  "Pioneering the bit frontier...",
  
  // Music & art
  "Composing a symphony of data...",
  "Painting with pixels...",
  "Choreographing the search dance...",
  "Tuning the algorithm orchestra...",
  "Sculpting your results...",
  "Writing poetry in binary...",
  "Harmonizing the frequencies...",
  "Conducting the data ensemble...",
  "Sketching digital dreams...",
  "Remixing reality...",
  
  // Whimsical & absurd
  "Asking the internet nicely...",
  "Convincing bits to behave...",
  "Untangling the spaghetti code...",
  "Reorganizing the chaos...",
  "Teaching robots to dream...",
  "Debugging the butterfly effect...",
  "Folding digital origami...",
  "Juggling information spheres...",
  "Balancing the binary see-saw...",
  "Herding Schrödinger's packets...",
  
  // Cosmic & ethereal
  "Decoding the universe...",
  "Aligning the digital stars...",
  "Consulting the constellation API...",
  "Translating cosmic whispers...",
  "Downloading stardust...",
  "Parsing the fabric of spacetime...",
  "Querying parallel universes...",
  "Intercepting thought waves...",
  "Channeling collective wisdom...",
  "Tuning into the akashic WiFi...",
  
  // Playful & cute
  "Giving the servers a pep talk...",
  "High-fiving the processors...",
  "Encouraging shy data to come out...",
  "Coaxing insights from hiding...",
  "Befriending lonely packets...",
  "Cheering on the search squad...",
  "Motivating sleepy servers...",
  "Applauding hardworking bytes...",
  "Hugging the database...",
  "Sending good vibes to the cloud...",
  
  // Meta & self-aware
  "Pretending to work very hard...",
  "Loading loading messages...",
  "Contemplating existence...",
  "Wondering why you're waiting...",
  "Philosophizing about search...",
  "Existentially querying...",
  "Meditating on your request...",
  "Having a moment of clarity...",
  "Achieving digital enlightenment...",
  "Finding inner peace... and results...",
]

/**
 * Get a random quirky message
 */
export function getRandomQuirkyMessage(): string {
  return QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]
}

/**
 * Get a random message different from the current one
 */
export function getNextQuirkyMessage(currentMessage: string): string {
  let newMessage = currentMessage
  let attempts = 0
  while (newMessage === currentMessage && attempts < 10) {
    newMessage = QUIRKY_MESSAGES[Math.floor(Math.random() * QUIRKY_MESSAGES.length)]
    attempts++
  }
  return newMessage
}

/**
 * Hook to get and rotate quirky messages
 */
import { useState, useEffect, useCallback } from 'react'

export function useQuirkyMessage(interval = 3000) {
  const [message, setMessage] = useState(() => getRandomQuirkyMessage())

  useEffect(() => {
    const timer = setInterval(() => {
      setMessage(prev => getNextQuirkyMessage(prev))
    }, interval)

    return () => clearInterval(timer)
  }, [interval])

  const refresh = useCallback(() => {
    setMessage(prev => getNextQuirkyMessage(prev))
  }, [])

  return { message, refresh }
}

export default QUIRKY_MESSAGES
