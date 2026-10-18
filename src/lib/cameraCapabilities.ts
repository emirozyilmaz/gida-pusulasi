export type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
};

export function cameraCapabilities(track: MediaStreamTrack): CameraCapabilities {
  try { return track.getCapabilities() as CameraCapabilities; }
  catch { return {} as CameraCapabilities; }
}

export async function applyCameraControl(track: MediaStreamTrack, key: string, value: string | number | boolean): Promise<void> {
  await track.applyConstraints({ advanced: [{ [key]: value } as MediaTrackConstraintSet] });
}
