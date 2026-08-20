import type { LineArrival, Repositories } from "@njt/db";
import {
  CERTIFICATE_THRESHOLD_SECONDS,
  LOW_SAMPLE_THRESHOLD,
  NJT_TIMEZONE,
  bandForHour,
  toLocalDateString,
  bandHours,
  bandLabel,
  isCertificateIssued,
  localHourOfDay,
  orderedBands,
  type CertificateBand,
  type CertificateBandResult,
  type CertificateResponse,
} from "@njt/shared";
import { Hono } from "hono";
import { badRequest, CACHE_CONTROL_DAILY, round1 } from "../util";

const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function bandResult(band: CertificateBand, arrivals: readonly LineArrival[]): CertificateBandResult {
  const { startHour, endHour } = bandHours(band);
  const delays = arrivals.map((a) => a.delaySeconds);
  const observed = delays.length;
  const late = delays.filter((d) => d >= CERTIFICATE_THRESHOLD_SECONDS).length;
  const avg = observed === 0 ? 0 : delays.reduce((sum, d) => sum + d, 0) / observed;
  return {
    band,
    label: bandLabel(band),
    startHour,
    endHour,
    trainsObserved: observed,
    trainsLate: late,
    latePercent: observed === 0 ? 0 : round1((late / observed) * 100),
    avgDelaySeconds: round1(avg),
    maxDelaySeconds: observed === 0 ? 0 : Math.max(...delays),
    // An empty band is not a punctual one, so it cannot earn a certificate.
    issued: observed > 0 && isCertificateIssued(avg),
    lowSample: observed < LOW_SAMPLE_THRESHOLD,
  };
}

export function certificateRoutes(repos: Repositories): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const requestedDate = c.req.query("date");
    if (requestedDate !== undefined && !SERVICE_DATE.test(requestedDate)) {
      badRequest("date must be YYYY-MM-DD");
    }
    const availableDates = repos.events.serviceDates();
    // Trips past midnight open tomorrow's partition, so the newest date held is
    // routinely in the future; defaulting to it certifies four overnight trains.
    const today = toLocalDateString(Math.floor(Date.now() / 1000));
    const serviceDate =
      requestedDate ?? availableDates.filter((d) => d <= today).at(-1) ?? availableDates.at(-1) ?? "";
    const lines = serviceDate === "" ? [] : repos.events.lineNamesOnDate(serviceDate);
    const lineName = c.req.query("line") ?? lines[0] ?? "";

    const arrivals = lineName === "" ? [] : repos.events.arrivalsOnDate(lineName, serviceDate);
    const byBand = new Map<CertificateBand, LineArrival[]>();
    for (const arrival of arrivals) {
      const band = bandForHour(localHourOfDay(arrival.observedArrival, NJT_TIMEZONE));
      byBand.set(band, [...(byBand.get(band) ?? []), arrival]);
    }

    const bands = orderedBands().map((band) => bandResult(band, byBand.get(band) ?? []));
    const issuedBands = bands.filter((b) => b.issued);
    const worst = issuedBands.reduce<CertificateBandResult | null>(
      (worstSoFar, band) =>
        worstSoFar === null || band.avgDelaySeconds > worstSoFar.avgDelaySeconds ? band : worstSoFar,
      null,
    );

    const response: CertificateResponse = {
      lineName,
      serviceDate,
      thresholdSeconds: CERTIFICATE_THRESHOLD_SECONDS,
      bands,
      issued: issuedBands.length > 0,
      worstBand: worst?.band ?? null,
      availableDates,
      lines,
    };
    c.header("Cache-Control", CACHE_CONTROL_DAILY);
    return c.json(response);
  });

  return router;
}
