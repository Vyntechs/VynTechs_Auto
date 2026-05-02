'use client'

import { Microphone, Camera, VideoCamera, Scan } from '@phosphor-icons/react/dist/ssr'

type Mode = 'voice' | 'photo' | 'video' | 'scan'

export function CaptureBar({ onCapture }: { onCapture?: (mode: Mode) => void }) {
  return (
    <nav className="capture-bar" aria-label="Capture toolbar">
      <button
        type="button"
        className="primary"
        onClick={() => onCapture?.('voice')}
        aria-label="Voice"
      >
        <Microphone size={20} aria-hidden="true" /> Voice
      </button>
      <button type="button" onClick={() => onCapture?.('photo')} aria-label="Photo">
        <Camera size={20} aria-hidden="true" /> Photo
      </button>
      <button type="button" onClick={() => onCapture?.('video')} aria-label="Video">
        <VideoCamera size={20} aria-hidden="true" /> Video
      </button>
      <button type="button" onClick={() => onCapture?.('scan')} aria-label="Scan">
        <Scan size={20} aria-hidden="true" /> Scan
      </button>
    </nav>
  )
}
