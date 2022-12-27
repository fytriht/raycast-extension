import { closeMainWindow, Detail, getPreferenceValues, LocalStorage, Clipboard, PopToRootType } from "./raycast";
import assert from "assert";
import { useEffect, useState } from "react";

export interface PreferenceValues {
  readonly setappToken: string;
  readonly setappRefreshToken: string;
  readonly setappPassword: string;
}

const preferenceValues = getPreferenceValues<PreferenceValues>();

const tokenStore = ((defaultToken: string, defaultRefreshToken: string) => {
  const KEY_TOKEN = "Token";
  const KEY_REFRESH_TOKEN = "RefreshToken";
  return {
    async getToken(): Promise<string> {
      return (await LocalStorage.getItem(KEY_TOKEN)) ?? defaultToken;
    },
    async getRefreshToken(): Promise<string> {
      return (await LocalStorage.getItem(KEY_REFRESH_TOKEN)) ?? defaultRefreshToken;
    },
    async updateTokens(token: string, refreshToken: string) {
      await Promise.all([
        LocalStorage.setItem(KEY_TOKEN, token),
        LocalStorage.setItem(KEY_REFRESH_TOKEN, refreshToken),
      ]);
    },
  };
})(preferenceValues.setappToken, preferenceValues.setappRefreshToken);

export type Logger = (text: string) => void;

export interface Device {
  id: number;
  name: string;
}

export async function main(logger: Logger) {
  async function request(req: Request): Promise<Response> {
    const resp = await fetch(
      new Request(req, {
        headers: {
          Authorization: `Bearer ${await tokenStore.getToken()}`,
          Accept: "application/json",
        },
      })
    );
    if (resp.ok) {
      return resp;
    } else if (resp.status === 401) {
      logger("token expired, refreshing");
      const req = new Request("https://user-api.setapp.com/v1/token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: await tokenStore.getRefreshToken() }),
      });
      const resp = await request(req);
      const data = await resp.json().then((json): { token: string; refresh_token: string } => json.data);
      await tokenStore.updateTokens(data.token, data.refresh_token);

      logger("token refreshed, start resending request");
      return request(req);
    } else {
      throw Error(`request error: ${req.url}`);
    }
  }

  let devices: Device[];
  {
    logger("start fetching devices.");
    const req = new Request("https://user-api.setapp.com/v1/devices");
    const resp = await request(req);
    devices = await resp.json().then((json): Device[] => json.data);
  }

  if (devices.length > 0) {
    logger(`fetched devices: ${devices.map((device) => device.name).join(", ")}`);
    assert(devices.length === 1, `Unexpected device count, got ${devices.length} devices.`);
    const deviceToBeDisconnect = devices.at(0)!;

    logger(`disconnecting device of id: ${deviceToBeDisconnect.id}`);
    const req = new Request(`https://user-api.setapp.com/v1/devices/${deviceToBeDisconnect.id}`, { method: "DELETE" });
    await request(req);
    logger("device disconnected");

    await Clipboard.copy(preferenceValues.setappPassword);
    logger("done.");
  } else {
    logger("there is no active devices, closing...");
  }

  await delay(4000);
  await closeMainWindow({ popToRootType: PopToRootType.Immediate });
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function () {
  const [texts, setTexts] = useState<string[]>([]);

  useEffect(() => {
    main((text: string) => {
      setTexts((texts) => texts.concat(text));
    });
  }, []);

  return <Detail markdown={texts.map((t) => `* ${t}`).join("\n")} />;
}
