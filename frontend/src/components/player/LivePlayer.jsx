import { useRef, useEffect } from "react"

export default function LivePlayer({ camera, online }) {

  const videoRef = useRef(null)

  if (!camera) return null

  const streamUrl = `/live/${camera.name}`


  useEffect(() => {

    const video = videoRef.current
    if (!video) return

    video.src = streamUrl
    video.play().catch(() => {})

  }, [streamUrl])


  if (!online) {

    return (
      <div className="flex items-center justify-center h-full bg-black text-gray-400">
        Camera Offline
      </div>
    )

  }

  return (

    <div className="w-full h-full bg-black">

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        className="w-full h-full object-contain"
      />

    </div>

  )

}