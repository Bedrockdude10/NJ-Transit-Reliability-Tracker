import {
  CERTIFICATE_BANDS,
  OTP_STRICT_THRESHOLD_SECONDS,
  PEAK_WINDOWS,
  type CertificateBand,
} from "./constants";

/**
 * See README "Delay certificate". Separate from the OTP threshold it equals: JR
 * East's rule is five minutes, and is not ours to move if our OTP bar moves.
 */
export const CERTIFICATE_THRESHOLD_SECONDS = OTP_STRICT_THRESHOLD_SECONDS;

/** Which band a local hour falls in. Derived from {@link PEAK_WINDOWS}. */
export function bandForHour(hour: number): CertificateBand {
  const { amPeakStartHour, amPeakEndHour, pmPeakStartHour, pmPeakEndHour } = PEAK_WINDOWS;
  if (hour < amPeakStartHour) return "early";
  if (hour < amPeakEndHour) return "am_peak";
  if (hour < pmPeakStartHour) return "midday";
  if (hour < pmPeakEndHour) return "pm_peak";
  return "evening";
}

const BAND_LABELS: Record<CertificateBand, string> = {
  early: "Before the morning peak",
  am_peak: "Morning peak",
  midday: "Midday",
  pm_peak: "Evening peak",
  evening: "Late evening",
};

export function bandLabel(band: CertificateBand): string {
  return BAND_LABELS[band];
}

/** Local hours covered, as `[startHour, endHour)`; `endHour` 24 is midnight. */
export function bandHours(band: CertificateBand): { startHour: number; endHour: number } {
  const { amPeakStartHour, amPeakEndHour, pmPeakStartHour, pmPeakEndHour } = PEAK_WINDOWS;
  switch (band) {
    case "early":
      return { startHour: 0, endHour: amPeakStartHour };
    case "am_peak":
      return { startHour: amPeakStartHour, endHour: amPeakEndHour };
    case "midday":
      return { startHour: amPeakEndHour, endHour: pmPeakStartHour };
    case "pm_peak":
      return { startHour: pmPeakStartHour, endHour: pmPeakEndHour };
    case "evening":
      return { startHour: pmPeakEndHour, endHour: 24 };
  }
}

/**
 * The average, not the median: a band where a few trains were catastrophic is the
 * case a rider needs to document, and a median reports it as a normal day.
 */
export function isCertificateIssued(avgDelaySeconds: number): boolean {
  return avgDelaySeconds >= CERTIFICATE_THRESHOLD_SECONDS;
}

/** Every band, in the order a day runs. */
export function orderedBands(): readonly CertificateBand[] {
  return CERTIFICATE_BANDS;
}
