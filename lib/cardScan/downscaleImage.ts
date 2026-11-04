// A phone's camera-capture file input (NewLeadDialog's mobile "Scan card"
// path) hands back the full-resolution photo — commonly 3000-7000px on the
// long edge, several MB. Both of this photo's consumers (decodeCardQr's
// on-device pixel decode, and the Vision OCR upload) work just as well on a
// much smaller version: a QR code only needs enough resolution to resolve
// its own modules, and Vision's text detection doesn't need more pixels
// than a sharp phone photo already has well past this size. Downscaling
// once here, before either consumer runs, is what actually fixes a
// "low memory" condition on the device — decodeCardQr's own full-size
// createImageBitmap()+getImageData() path was allocating a raw RGBA buffer
// of roughly width*height*4 bytes (100+ MB for a modern phone photo) for a
// QR scan that, most of the time, finds no code at all.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85

export async function downscaleImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) return file // Already small enough (e.g. a desktop upload) — no re-encode needed.

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file
    return new File([blob], file.name, { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
