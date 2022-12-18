import { Request } from "node-fetch";
import { SetappClient, TokenStore } from "./disconnectSetappDevices";
import { LocalStorage } from "./raycast";

(globalThis as any).Request = Request;
(globalThis as any).fetch = jest.fn();

jest.mock("./raycast", () => {
  return {
    LocalStorage: {
      kv: {} as Record<string, string>,
      async getItem(k: string) {
        return this.kv[k];
      },
      async setItem(k: string, v: string) {
        this.kv[k] = v;
      },
    },
    getPreferenceValues: () => {},
  };
});

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TokenStore", () => {
  describe("TokenStore.getToken", () => {
    const ts = new TokenStore("__default_token__", "__default_refresh_token__");

    test("get tokens from defaults", async () => {
      const spy = jest.spyOn(LocalStorage, "getItem");
      spy.mockImplementationOnce(async () => {
        return undefined;
      });
      expect(await ts.getToken()).toBe("__default_token__");
    });

    test("get tokens from LocalStorage", async () => {
      const spy = jest.spyOn(LocalStorage, "getItem");
      spy.mockImplementationOnce(async () => {
        return "__secret_token__";
      });
      expect(await ts.getToken()).toBe("__secret_token__");
    });
  });

  describe("TokenStore.getRefreshToken", () => {
    const ts = new TokenStore("__default_token__", "__default_refresh_token__");

    test("get refresh tokens from defaults", async () => {
      const spy = jest.spyOn(LocalStorage, "getItem");
      spy.mockImplementationOnce(async () => {
        return undefined;
      });
      expect(await ts.getRefreshToken()).toBe("__default_refresh_token__");
    });

    test("get refresh tokens from LocalStorage", async () => {
      const spy = jest.spyOn(LocalStorage, "getItem");
      spy.mockImplementationOnce(async () => {
        return "__secret_refresh_token__";
      });
      expect(await ts.getRefreshToken()).toBe("__secret_refresh_token__");
    });
  });

  describe("TokenStore.updateTokens", () => {
    test("update tokens' value", async () => {
      const ts = new TokenStore("__default_token__", "__default_refresh_token__");

      // initial
      expect(await ts.getToken()).toBe("__default_token__");
      expect(await ts.getRefreshToken()).toBe("__default_refresh_token__");

      // update 1
      await ts.updateTokens("__tk__", "__rtk__");
      expect(await ts.getToken()).toBe("__tk__");
      expect(await ts.getRefreshToken()).toBe("__rtk__");

      // update 2
      await ts.updateTokens("__tk_2__", "__rtk_2__");
      expect(await ts.getToken()).toBe("__tk_2__");
      expect(await ts.getRefreshToken()).toBe("__rtk_2__");
    });
  });
});

describe("SetappClient", () => {
  const setapp = new SetappClient(
    {
      async getToken() {
        return "__token__";
      },
      async getRefreshToken() {
        return "__refresh_token__";
      },
      async updateTokens() {},
    },
    () => {}
  );

  test("fetch active devices", async () => {
    const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                id: 123,
                name: "macOS",
              },
            ],
          };
        },
      } as any;
    });

    const devices = await setapp.fetchActiveDevices();

    expect(devices).toMatchInlineSnapshot(`
      [
        {
          "id": 123,
          "name": "macOS",
        },
      ]
    `);

    expect(fetch).toBeCalledTimes(1);

    const firstArgOfFetch = fetch.mock.calls.at(0)?.at(0) as unknown as Request;

    expect(firstArgOfFetch.url).toMatchInlineSnapshot(`"https://user-api.setapp.com/v1/devices"`);

    expect(firstArgOfFetch.headers).toMatchInlineSnapshot(`
      Headers {
        Symbol(map): {
          "Accept": [
            "application/json",
          ],
          "Authorization": [
            "Bearer __token__",
          ],
        },
      }
    `);
  });

  test("refresh token", async () => {
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        async json() {
          return {
            data: { token: "11", refresh_token: "22" },
          };
        },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                id: 123,
                name: "macOS",
              },
            ],
          };
        },
      } as any);

    const devices = await setapp.fetchActiveDevices();

    expect(devices).toMatchInlineSnapshot(`
        [
          {
            "id": 123,
            "name": "macOS",
          },
        ]
      `);

    expect(fetch).toBeCalledTimes(3);

    // first call
    // @ts-expect-error
    expect(fetch.mock.calls[0]?.[0].url).toMatchInlineSnapshot(`"https://user-api.setapp.com/v1/devices"`);
    // @ts-expect-error
    expect(fetch.mock.calls[0]?.[0].headers).toMatchInlineSnapshot(`
      Headers {
        Symbol(map): {
          "Accept": [
            "application/json",
          ],
          "Authorization": [
            "Bearer __token__",
          ],
        },
      }
    `);

    // second call
    // @ts-expect-error
    expect(fetch.mock.calls[1]?.[0].url).toMatchInlineSnapshot(`"https://user-api.setapp.com/v1/token"`);
    // @ts-expect-error
    expect(fetch.mock.calls[1]?.[0].headers).toMatchInlineSnapshot(`
      Headers {
        Symbol(map): {
          "Accept": [
            "application/json",
          ],
          "Authorization": [
            "Bearer __token__",
          ],
        },
      }
    `);

    // third call
    // @ts-expect-error
    expect(fetch.mock.calls[2]?.[0].url).toMatchInlineSnapshot(`"https://user-api.setapp.com/v1/devices"`);
    // @ts-expect-error
    expect(fetch.mock.calls[2]?.[0].headers).toMatchInlineSnapshot(`
      Headers {
        Symbol(map): {
          "Accept": [
            "application/json",
          ],
          "Authorization": [
            "Bearer __token__",
          ],
        },
      }
    `);
  });

  test("unexpected fetch error", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
      } as any;
    });
    expect(setapp.fetchActiveDevices()).rejects.toMatchInlineSnapshot(
      `[Error: request error: https://user-api.setapp.com/v1/devices]`
    );
  });

  test("disconnect device by ID", async () => {
    const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return {
        ok: true,
      } as any;
    });

    expect(fetch).not.toBeCalled();
    await setapp.disconnectDeviceById(111);
    expect(fetch).toBeCalledTimes(1);

    // @ts-expect-error
    expect(fetch.mock.calls[0]?.[0].url).toMatchInlineSnapshot(`"https://user-api.setapp.com/v1/devices/111"`);
    // @ts-expect-error
    expect(fetch.mock.calls[0]?.[0].headers).toMatchInlineSnapshot(`
      Headers {
        Symbol(map): {
          "Accept": [
            "application/json",
          ],
          "Authorization": [
            "Bearer __token__",
          ],
        },
      }
    `);
  });

  test("disposing", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
      init?.signal?.throwIfAborted();
      return undefined as any
    });
    const p = setapp.fetchActiveDevices();
    setapp.dispose();
    try {
      await p;
    } catch (e: any) {
      expect(e.toString()).toMatchInlineSnapshot(`"AbortError: This operation was aborted"`);
    }
  });
});
