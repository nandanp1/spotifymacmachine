import { createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

import {
  createOAuthState,
  createPkcePair,
  SpotifyAuthError,
  SpotifyAuthService,
  validateLoopbackRedirectUri,
} from "../../src/main/auth";
import { SecureTokenStore } from "../../src/main/secure-store";
import type { SpotifyTokenRecord } from "../../src/shared/types";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: Deferred<T>["resolve"] = () => undefined;
  let rejectPromise: Deferred<T>["reject"] = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

async function getAvailableLoopbackPort(): Promise<number> {
  const server = createNetServer();

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(
      {
        host: "127.0.0.1",
        port: 0,
        exclusive: true,
      },
      () => {
        server.off("error", onError);
        resolve();
      },
    );
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    throw new Error("The loopback test server did not expose a TCP port.");
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

function createSuccessfulTokenResponse(
  accessToken: string,
  refreshToken?: string,
): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3_600,
      scope: "streaming user-read-email",
      ...(refreshToken === undefined
        ? {}
        : { refresh_token: refreshToken }),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function createTokenHarness(initial: SpotifyTokenRecord | null) {
  let serialized = initial === null ? null : JSON.stringify(initial);
  const keychain = {
    getPassword: vi.fn(async () => serialized),
    setPassword: vi.fn(async (_service: string, _account: string, value: string) => {
      serialized = value;
    }),
    deletePassword: vi.fn(async () => {
      serialized = null;
      return true;
    }),
  };

  return {
    keychain,
    store: new SecureTokenStore(keychain),
    read: () =>
      serialized === null
        ? null
        : (JSON.parse(serialized) as SpotifyTokenRecord),
  };
}

describe("PKCE helpers", () => {
  it("creates an RFC 7636-compatible verifier and S256 challenge", () => {
    const pair = createPkcePair();
    const expectedChallenge = createHash("sha256")
      .update(pair.verifier)
      .digest("base64url");

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pair.challenge).toBe(expectedChallenge);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses fresh entropy for every verifier and OAuth state", () => {
    const firstPair = createPkcePair();
    const secondPair = createPkcePair();
    const firstState = createOAuthState();
    const secondState = createOAuthState();

    expect(secondPair.verifier).not.toBe(firstPair.verifier);
    expect(secondPair.challenge).not.toBe(firstPair.challenge);
    expect(firstState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondState).not.toBe(firstState);
  });
});

describe("loopback redirect validation", () => {
  it("accepts the exact loopback host and callback path", () => {
    const redirect = validateLoopbackRedirectUri(
      "http://127.0.0.1:43821/callback",
    );

    expect(redirect.hostname).toBe("127.0.0.1");
    expect(redirect.port).toBe("43821");
    expect(redirect.pathname).toBe("/callback");
  });

  it.each([
    "https://127.0.0.1:43821/callback",
    "http://localhost:43821/callback",
    "http://127.0.0.1/callback",
    "http://127.0.0.1:43821/callback/extra",
    "http://user@127.0.0.1:43821/callback",
    "http://127.0.0.1:43821/callback?next=/",
    "http://127.0.0.1:43821/callback#token",
    "not a URL",
  ])("rejects an unsafe redirect URI: %s", (value) => {
    expect(() => validateLoopbackRedirectUri(value)).toThrow(
      SpotifyAuthError,
    );

    try {
      validateLoopbackRedirectUri(value);
    } catch (error) {
      expect(error).toMatchObject({ code: "configuration" });
    }
  });
});

describe("token expiry and refresh errors", () => {
  const now = 1_800_000_000_000;
  const baseTokens: SpotifyTokenRecord = {
    accessToken: "old-access-token",
    refreshToken: "renew-me",
    tokenType: "Bearer",
    scopes: ["streaming", "user-read-email"],
    expiresAt: now + 30_000,
  };

  it("refreshes inside the expiry skew and calculates the next expiry in milliseconds", async () => {
    const harness = createTokenHarness(baseTokens);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "fresh-access-token",
          token_type: "Bearer",
          expires_in: 3_600,
          scope: "streaming user-read-email",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const auth = new SpotifyAuthService(harness.store, {
      clientId: "test-client",
      fetchImpl,
      now: () => now,
    });

    await expect(auth.getState()).resolves.toEqual({
      status: "authenticated",
      expiresAt: now + 3_600_000,
      scopes: ["streaming", "user-read-email"],
    });
    expect(harness.read()).toMatchObject({
      accessToken: "fresh-access-token",
      refreshToken: "renew-me",
      expiresAt: now + 3_600_000,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps a still-valid token when an early refresh fails offline", async () => {
    const harness = createTokenHarness(baseTokens);
    const auth = new SpotifyAuthService(harness.store, {
      clientId: "test-client",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      }),
      now: () => now,
    });

    await expect(auth.getState()).resolves.toEqual({
      status: "authenticated",
      expiresAt: baseTokens.expiresAt,
      scopes: baseTokens.scopes,
    });
    expect(harness.read()).toEqual(baseTokens);
  });

  it("maps an expired rejected refresh to a recoverable auth state", async () => {
    const expired = { ...baseTokens, expiresAt: now - 1 };
    const harness = createTokenHarness(expired);
    const auth = new SpotifyAuthService(harness.store, {
      clientId: "test-client",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
      now: () => now,
    });

    await expect(auth.getState()).resolves.toEqual({
      status: "expired",
      reason: "refreshRejected",
    });
  });

  it("maps an unavailable Keychain without exposing stored values", async () => {
    const keychain = {
      getPassword: vi.fn(async () => {
        throw new Error("secret system detail");
      }),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true),
    };
    const auth = new SpotifyAuthService(new SecureTokenStore(keychain), {
      clientId: "test-client",
      now: () => now,
    });

    await expect(auth.getState()).resolves.toEqual({
      status: "expired",
      reason: "keychain",
    });
  });
});

describe("authentication lifecycle invalidation", () => {
  const now = 1_800_000_000_000;
  const expiringTokens: SpotifyTokenRecord = {
    accessToken: "old-access-token",
    refreshToken: "renew-me",
    tokenType: "Bearer",
    scopes: ["streaming", "user-read-email"],
    expiresAt: now + 30_000,
  };

  it("deduplicates an in-flight refresh and lets sign-out cancel every waiter", async () => {
    const harness = createTokenHarness(expiringTokens);
    const tokenResponse = createDeferred<Response>();
    const fetchImpl = vi.fn(async () => tokenResponse.promise);
    const auth = new SpotifyAuthService(harness.store, {
      clientId: "test-client",
      fetchImpl,
      now: () => now,
    });
    const emittedStates: unknown[] = [];
    auth.subscribe((state) => {
      emittedStates.push(state);
    });

    const statePromise = auth.getState();
    const playbackTokenPromise = auth.getWebPlaybackToken();
    const playbackTokenRejection = expect(
      playbackTokenPromise,
    ).rejects.toMatchObject({
      code: "operationCancelled",
    });

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledOnce();
    });

    await expect(auth.signOut()).resolves.toEqual({ status: "signedOut" });
    tokenResponse.resolve(createSuccessfulTokenResponse("late-access-token"));

    await expect(statePromise).resolves.toEqual({ status: "signedOut" });
    await playbackTokenRejection;
    expect(harness.keychain.setPassword).not.toHaveBeenCalled();
    expect(harness.read()).toBeNull();
    expect(emittedStates).toEqual([{ status: "signedOut" }]);
  });

  it("queues the sign-out deletion after a Keychain write that already started", async () => {
    let serialized: string | null = JSON.stringify(expiringTokens);
    const setStarted = createDeferred<void>();
    const releaseSet = createDeferred<void>();
    const keychain = {
      getPassword: vi.fn(async () => serialized),
      setPassword: vi.fn(
        async (_service: string, _account: string, value: string) => {
          setStarted.resolve(undefined);
          await releaseSet.promise;
          serialized = value;
        },
      ),
      deletePassword: vi.fn(async () => {
        serialized = null;
        return true;
      }),
    };
    const auth = new SpotifyAuthService(new SecureTokenStore(keychain), {
      clientId: "test-client",
      fetchImpl: vi.fn(async () =>
        createSuccessfulTokenResponse("late-access-token"),
      ),
      now: () => now,
    });
    const emittedStates: unknown[] = [];
    auth.subscribe((state) => {
      emittedStates.push(state);
    });

    const playbackTokenPromise = auth.getWebPlaybackToken();
    const playbackTokenRejection = expect(
      playbackTokenPromise,
    ).rejects.toMatchObject({
      code: "operationCancelled",
    });
    await setStarted.promise;

    const signOutPromise = auth.signOut();
    expect(keychain.deletePassword).not.toHaveBeenCalled();
    releaseSet.resolve(undefined);

    await expect(signOutPromise).resolves.toEqual({ status: "signedOut" });
    await playbackTokenRejection;
    expect(keychain.setPassword).toHaveBeenCalledOnce();
    expect(keychain.deletePassword).toHaveBeenCalledOnce();
    expect(serialized).toBeNull();
    expect(emittedStates).toEqual([{ status: "signedOut" }]);
  });

  it("cancels a sign-in token exchange before it can persist or emit", async () => {
    const port = await getAvailableLoopbackPort();
    const harness = createTokenHarness(null);
    const tokenResponse = createDeferred<Response>();
    const observedSignals: Array<AbortSignal | null> = [];
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        observedSignals.push(init?.signal ?? null);
        return tokenResponse.promise;
      },
    );
    const openExternal = vi.fn(async (authorizationUrl: string) => {
      const authorization = new URL(authorizationUrl);
      const callback = new URL(
        authorization.searchParams.get("redirect_uri") ?? "",
      );
      callback.searchParams.set("code", "authorization-code");
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state") ?? "",
      );

      const response = await fetch(callback);
      expect(response.status).toBe(200);
      await response.text();
    });
    const auth = new SpotifyAuthService(harness.store, {
      clientId: "test-client",
      redirectUri: `http://127.0.0.1:${port}/callback`,
      fetchImpl,
      openExternal,
      now: () => now,
    });
    const emittedStates: unknown[] = [];
    auth.subscribe((state) => {
      emittedStates.push(state);
    });

    const signInPromise = auth.signIn();
    const signInRejection = expect(signInPromise).rejects.toMatchObject({
      code: "operationCancelled",
    });
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledOnce();
    });

    await expect(auth.signOut()).resolves.toEqual({ status: "signedOut" });
    expect(observedSignals[0]?.aborted).toBe(true);
    tokenResponse.resolve(
      createSuccessfulTokenResponse(
        "late-sign-in-token",
        "late-refresh-token",
      ),
    );

    await signInRejection;
    expect(harness.keychain.setPassword).not.toHaveBeenCalled();
    expect(harness.read()).toBeNull();
    expect(emittedStates).toEqual([{ status: "signedOut" }]);
  });
});
