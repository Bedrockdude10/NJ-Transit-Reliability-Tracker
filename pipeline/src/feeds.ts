import type { PipelineConfig } from "./config";

/**
 * Fetches raw bytes from the NJT real-time feeds. The interface is what the
 * ingestor depends on, so tests inject a fake instead of hitting the network.
 */
export interface FeedClient {
  fetchTripUpdates(): Promise<Uint8Array>;
  fetchVehiclePositions(): Promise<Uint8Array>;
  fetchServiceAlerts(): Promise<Uint8Array>;
}

/**
 * HTTP feed client. NJT's GTFS-RT endpoints take an API key; this sends it both
 * as an `apikey` header and `?apikey=` query param to tolerate either contract.
 * The proto bytes are returned verbatim for snapshot storage + parsing.
 */
export class HttpFeedClient implements FeedClient {
  constructor(
    private readonly config: PipelineConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async fetchProto(url: string): Promise<Uint8Array> {
    if (!url) throw new Error("Feed URL is not configured");
    const key = this.config.gtfsRtApiKey;
    const withKey = key ? `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(key)}` : url;
    const response = await this.fetchImpl(withKey, {
      headers: key ? { apikey: key, Accept: "application/x-protobuf" } : { Accept: "application/x-protobuf" },
    });
    if (!response.ok) throw new Error(`Feed request failed: ${response.status} ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  fetchTripUpdates(): Promise<Uint8Array> {
    return this.fetchProto(this.config.urls.tripUpdates);
  }
  fetchVehiclePositions(): Promise<Uint8Array> {
    return this.fetchProto(this.config.urls.vehiclePositions);
  }
  fetchServiceAlerts(): Promise<Uint8Array> {
    return this.fetchProto(this.config.urls.serviceAlerts);
  }
}
