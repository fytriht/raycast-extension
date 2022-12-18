import { closeMainWindow, Detail, getPreferenceValues, LocalStorage, Clipboard, PopToRootType } from "./raycast";
import assert from "assert";
import { useEffect, useState } from "react";

export interface PreferenceValues {
  readonly setappToken: string;
  readonly setappRefreshToken: string;
  readonly setappPassword: string;
}

const preferenceValues = getPreferenceValues<PreferenceValues>();

export interface ITokenStore {
  getToken(): Promise<string>
  getRefreshToken(): Promise<string>
  updateTokens(token: string, refreshToken: string): Promise<void>
}

export class TokenStore implements ITokenStore {
  private KEY_TOKEN = "Token";
  private KEY_REFRESH_TOKEN = "RefreshToken";

  constructor(private defaultToken: string, private defaultRefreshToken: string) {}

  async getToken(): Promise<string> {
    return (await LocalStorage.getItem(this.KEY_TOKEN)) ?? this.defaultToken;
  }

  async getRefreshToken(): Promise<string> {
    return (await LocalStorage.getItem(this.KEY_REFRESH_TOKEN)) ?? this.defaultRefreshToken;
  }

  async updateTokens(token: string, refreshToken: string) {
    await Promise.all([
      LocalStorage.setItem(this.KEY_TOKEN, token),
      LocalStorage.setItem(this.KEY_REFRESH_TOKEN, refreshToken),
    ]);
  }
}

export type Logger = (text: string) => void;

export interface Device {
  id: number;
  name: string;
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class SetappClient {
  private abortController = new AbortController();

  constructor(private tokenStore: ITokenStore, private logger: Logger) {}

  async fetchActiveDevices(): Promise<Device[]> {
    this.logger("start fetching devices.");
    const req = new Request("https://user-api.setapp.com/v1/devices");
    const resp = await this.request(req);
    const devices = await resp.json().then((json): Device[] => json.data);
    if (devices.length > 0) {
      this.logger(`fetched devices: ${devices.map((device) => device.name).join(", ")}`);
    }
    return devices;
  }

  async disconnectDeviceById(id: number): Promise<void> {
    this.logger(`disconnecting device of id: ${id}`);
    const req = new Request(`https://user-api.setapp.com/v1/devices/${id}`, { method: "DELETE" });
    await this.request(req);
    this.logger("device disconnected");
  }

  async dispose() {
    this.abortController.abort();
  }

  private async refreshToken() {
    const req = new Request("https://user-api.setapp.com/v1/token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: await this.tokenStore.getRefreshToken() }),
    });
    const resp = await this.request(req);
    const data = await resp.json().then((json): { token: string; refresh_token: string } => json.data);
    await this.tokenStore.updateTokens(data.token, data.refresh_token);
  }

  private async request(request: Request): Promise<Response> {
    request = new Request(request, {
      headers: {
        Authorization: `Bearer ${await this.tokenStore.getToken()}`,
        Accept: "application/json",
      },
    });
    const resp = await fetch(request, { signal: this.abortController.signal });
    if (resp.ok) {
      return resp;
    } else if (resp.status === 401) {
      this.logger("token expired, refreshing");
      await this.refreshToken();
      this.logger("token refreshed, start resending request");
      return this.request(request);
    } else {
      throw Error(`request error: ${request.url}`);
    }
  }
}

export function createSetappClient(logger: Logger) {
  const tokenStore = new TokenStore(preferenceValues.setappToken, preferenceValues.setappRefreshToken);
  return new SetappClient(tokenStore, logger);
}

export default function () {
  const [texts, setTexts] = useState<string[]>([]);

  useEffect(() => {
    const log = (text: string) => {
      setTexts((texts) => texts.concat(text));
    };
    const setappClient = createSetappClient(log);

    async function fn() {
      const devices = await setappClient.fetchActiveDevices();
      if (devices.length === 0) {
        log("there is no active devices, closing...");
        await delay(4000);
        await closeMainWindow({popToRootType: PopToRootType.Immediate });
        return;
      }
      assert(devices.length === 1, `Unexpected device count, got ${devices.length} devices.`);
      const deviceToBeDisconnect = devices.at(0)!;
      await setappClient.disconnectDeviceById(deviceToBeDisconnect.id);
      await Clipboard.copy(preferenceValues.setappPassword);
      log("done.");
      await delay(4000);
      await closeMainWindow({popToRootType: PopToRootType.Immediate });
    }
    fn();

    return () => {
      setappClient.dispose();
    };
  }, []);

  return <Detail markdown={texts.map((t) => `* ${t}`).join("\n")} />;
}
